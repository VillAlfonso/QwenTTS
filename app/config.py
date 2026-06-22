"""Central configuration: paths, model repos, and default settings.

Importing this module sets HF_HOME so every model weight is downloaded *inside*
the project (C:\\QwenTTS\\models) instead of the user profile. Import it before
`qwen_tts` / `transformers` anywhere in the app.
"""
from __future__ import annotations

import os
import shutil
from pathlib import Path

# --- paths -----------------------------------------------------------------
BASE_DIR = Path(__file__).resolve().parent.parent          # C:\QwenTTS
APP_DIR = BASE_DIR / "app"
WEB_DIR = BASE_DIR / "web"
DATA_DIR = BASE_DIR / "data"
OUTPUTS_DIR = DATA_DIR / "outputs"                          # generated audio
REFS_DIR = DATA_DIR / "refs"                               # uploaded clone samples
MODELS_DIR = BASE_DIR / "models"                          # HF weight cache

for _d in (DATA_DIR, OUTPUTS_DIR, REFS_DIR, MODELS_DIR):
    _d.mkdir(parents=True, exist_ok=True)

# Keep model weights local to the project and use the fast downloader.
os.environ.setdefault("HF_HOME", str(MODELS_DIR))
os.environ.setdefault("HF_HUB_ENABLE_HF_TRANSFER", "1")
os.environ.setdefault("TOKENIZERS_PARALLELISM", "false")

SETTINGS_FILE = DATA_DIR / "settings.json"
HISTORY_FILE = DATA_DIR / "history.json"
CUSTOM_VOICES_FILE = DATA_DIR / "voices_custom.json"

# --- models ----------------------------------------------------------------
# Each "size" maps a task -> Hugging Face repo id. The model bundles its own
# 12Hz codec under speech_tokenizer/, so one download per task is self-contained.
MODEL_REPOS = {
    "1.7B": {
        "custom_voice": "Qwen/Qwen3-TTS-12Hz-1.7B-CustomVoice",
        "voice_design": "Qwen/Qwen3-TTS-12Hz-1.7B-VoiceDesign",
        "base": "Qwen/Qwen3-TTS-12Hz-1.7B-Base",
    },
    "0.6B": {
        "custom_voice": "Qwen/Qwen3-TTS-12Hz-0.6B-CustomVoice",
        # 0.6B has no VoiceDesign checkpoint and no instruction control.
        "base": "Qwen/Qwen3-TTS-12Hz-0.6B-Base",
    },
}

# --- defaults --------------------------------------------------------------
DEFAULT_SETTINGS = {
    "model_size": "1.7B",        # "1.7B" (quality) | "0.6B" (faster, no instruct/design)
    "device": "cpu",            # "cpu" | "dml" (experimental AMD GPU via DirectML)
    "default_speaker": "Ryan",
    "default_language": "Auto",
    "output_format": "mp3",      # "mp3" | "wav" | "both"
    "loudnorm": True,            # normalize loudness to a YouTube-friendly target
    "loudnorm_i": -16.0,         # integrated loudness target (LUFS)
    "gap_ms": 180,               # silence inserted between sentence chunks
    "paragraph_gap_ms": 480,     # silence inserted between paragraphs
    "trim_silence": True,        # trim dead air at the head/tail of each chunk
    "max_chars": 240,            # max characters per synthesis chunk
    "max_loaded_models": 2,      # how many task-models kept resident in RAM (LRU)
    "sampling": {
        "temperature": 0.9,
        "top_p": 1.0,
        "top_k": 50,
        "repetition_penalty": 1.05,
        "max_new_tokens": 4096,
    },
}


def resolve_ffmpeg() -> str:
    """Return a usable ffmpeg binary path."""
    hint = os.environ.get("FFMPEG_BIN") or r"C:\ffmpeg\ffmpeg.exe"
    if Path(hint).exists():
        return hint
    return shutil.which("ffmpeg") or "ffmpeg"


def resolve_ffprobe() -> str:
    hint = os.environ.get("FFPROBE_BIN") or r"C:\ffmpeg\ffprobe.exe"
    if Path(hint).exists():
        return hint
    return shutil.which("ffprobe") or "ffprobe"


FFMPEG = resolve_ffmpeg()
FFPROBE = resolve_ffprobe()
