"""Local Qwen3-TTS inference engine.

Wraps the `qwen_tts` package: lazily loads task checkpoints (CustomVoice /
VoiceDesign / Base) with LRU eviction, runs synthesis on CPU (or experimental
DirectML), and caches voice-clone prompts. Torch and qwen_tts are imported
lazily so the web server starts instantly and import errors surface nicely.
"""
from __future__ import annotations

import threading
from collections import OrderedDict
from typing import Callable, Dict, List, Optional, Tuple

import numpy as np

from . import config, storage

ProgressFn = Callable[[str, float], None]

_load_lock = threading.RLock()    # guards model dict / loading + downloads
_infer_lock = threading.Lock()    # serializes generate() across requests


def repo_cached(repo: str) -> bool:
    """True if the model weights for `repo` are already in the local cache."""
    try:
        from huggingface_hub import try_to_load_from_cache
        return isinstance(try_to_load_from_cache(repo, "config.json"), str)
    except Exception:
        return False


class Engine:
    def __init__(self) -> None:
        self._models: "OrderedDict[Tuple[str, str], object]" = OrderedDict()
        self._clone_prompts: Dict[str, Tuple[int, object]] = {}
        self._torch = None
        self._model_cls = None
        self._import_error: Optional[str] = None

    # ---- imports ----------------------------------------------------------
    def ensure_imports(self):
        if self._torch is not None:
            return
        with _load_lock:
            if self._torch is not None:
                return
            try:
                import torch
                from qwen_tts import Qwen3TTSModel
                self._torch = torch
                self._model_cls = Qwen3TTSModel
            except Exception as exc:  # noqa: BLE001
                self._import_error = f"{type(exc).__name__}: {exc}"
                raise

    # ---- device / dtype ---------------------------------------------------
    def _resolve_device(self, pref: str):
        """Return (device_map_value, label). Falls back to CPU."""
        if pref == "dml":
            try:
                import torch_directml
                return torch_directml.device(), "dml"
            except Exception:
                return "cpu", "cpu"
        return "cpu", "cpu"

    def _dtype_attn(self, label: str):
        # float32 + no flash-attn is the robust, CPU/AMD-safe combination.
        return self._torch.float32, None

    # ---- model loading ----------------------------------------------------
    def get_model(self, task: str):
        settings = storage.get_settings()
        size = settings.get("model_size", "1.7B")
        repos = config.MODEL_REPOS.get(size, {})
        if task not in repos:
            raise ValueError(
                f"The {size} model set has no '{task}' checkpoint. "
                f"Switch the model size to 1.7B in Settings to use this feature."
            )
        key = (size, task)
        with _load_lock:
            if key in self._models:
                self._models.move_to_end(key)
                return self._models[key]

            self.ensure_imports()
            device_map, label = self._resolve_device(settings.get("device", "cpu"))
            dtype, attn = self._dtype_attn(label)
            model = self._model_cls.from_pretrained(
                repos[task], device_map=device_map, dtype=dtype,
                attn_implementation=attn,
            )
            self._models[key] = model
            self._models.move_to_end(key)

            max_loaded = max(1, int(settings.get("max_loaded_models", 2)))
            while len(self._models) > max_loaded:
                old_key, _ = self._models.popitem(last=False)
                # drop any clone prompts that referenced the evicted base model
                if old_key[1] == "base":
                    self._clone_prompts.clear()
                self._free()
            return model

    def _free(self):
        import gc
        gc.collect()

    # ---- generation kwargs ------------------------------------------------
    def _gen_kwargs(self, settings: Dict) -> Dict:
        s = settings.get("sampling", {})
        return dict(
            temperature=s.get("temperature"),
            top_p=s.get("top_p"),
            top_k=s.get("top_k"),
            repetition_penalty=s.get("repetition_penalty"),
            max_new_tokens=s.get("max_new_tokens"),
        )

    @staticmethod
    def _lang(language: Optional[str]) -> str:
        if not language or language == "Auto":
            return "Auto"
        return language

    # ---- custom voice -----------------------------------------------------
    def synth_custom(self, chunks: List[Dict], speaker: str, language: str,
                     instruct: Optional[str], progress: Optional[ProgressFn] = None
                     ) -> Tuple[List[Dict], int]:
        settings = storage.get_settings()
        model = self.get_model("custom_voice")
        gk = self._gen_kwargs(settings)
        lang = self._lang(language)
        segs: List[Dict] = []
        sr = 24000
        n = len(chunks)
        with _infer_lock:
            for i, ch in enumerate(chunks):
                if progress:
                    progress(f"Synthesizing {i + 1}/{n}", i / max(n, 1))
                wavs, sr = model.generate_custom_voice(
                    text=ch["text"], speaker=speaker, language=lang,
                    instruct=(instruct or None), **gk,
                )
                segs.append({"wav": wavs[0], "paragraph": ch.get("paragraph", 0)})
        if progress:
            progress("Synthesizing", 1.0)
        return segs, sr

    # ---- voice clone ------------------------------------------------------
    def _clone_prompt(self, voice: Dict, model):
        vid = voice["id"]
        cached = self._clone_prompts.get(vid)
        if cached and cached[0] == id(model):
            return cached[1]
        ref_audio = voice["ref_audio_path"]
        ref_text = voice.get("ref_text") or None
        if ref_text:
            items = model.create_voice_clone_prompt(
                ref_audio=ref_audio, ref_text=ref_text, x_vector_only_mode=False)
        else:
            items = model.create_voice_clone_prompt(
                ref_audio=ref_audio, x_vector_only_mode=True)
        self._clone_prompts[vid] = (id(model), items)
        return items

    def synth_clone(self, chunks: List[Dict], voice: Dict, language: str,
                    progress: Optional[ProgressFn] = None) -> Tuple[List[Dict], int]:
        settings = storage.get_settings()
        model = self.get_model("base")
        gk = self._gen_kwargs(settings)
        lang = self._lang(language)
        n = len(chunks)
        segs: List[Dict] = []
        sr = 24000
        with _infer_lock:
            if progress:
                progress("Analyzing reference voice", 0.0)
            prompt = self._clone_prompt(voice, model)
            for i, ch in enumerate(chunks):
                if progress:
                    progress(f"Synthesizing {i + 1}/{n}", i / max(n, 1))
                wavs, sr = model.generate_voice_clone(
                    text=ch["text"], language=lang, voice_clone_prompt=prompt, **gk,
                )
                segs.append({"wav": wavs[0], "paragraph": ch.get("paragraph", 0)})
        if progress:
            progress("Synthesizing", 1.0)
        return segs, sr

    # ---- voice design -----------------------------------------------------
    def design_preview(self, text: str, instruct: str, language: str,
                       progress: Optional[ProgressFn] = None) -> Tuple[np.ndarray, int]:
        settings = storage.get_settings()
        model = self.get_model("voice_design")
        gk = self._gen_kwargs(settings)
        lang = self._lang(language)
        with _infer_lock:
            if progress:
                progress("Designing voice", 0.3)
            wavs, sr = model.generate_voice_design(
                text=text, instruct=instruct, language=lang, **gk)
        if progress:
            progress("Designing voice", 1.0)
        return wavs[0], sr

    # ---- status -----------------------------------------------------------
    def status(self) -> Dict:
        settings = storage.get_settings()
        size = settings.get("model_size", "1.7B")
        repos = config.MODEL_REPOS.get(size, {})
        tasks = {
            task: {
                "repo": repo,
                "cached": repo_cached(repo),
                "loaded": (size, task) in self._models,
            }
            for task, repo in repos.items()
        }
        return {
            "device": settings.get("device", "cpu"),
            "model_size": size,
            "tasks": tasks,
            "torch_ready": self._torch is not None,
            "import_error": self._import_error,
        }


engine = Engine()
