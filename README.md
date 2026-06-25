# Qwen3-TTS Studio 🎙️

A local, private, **human-sounding** text-to-speech studio built on
[Qwen3-TTS](https://github.com/QwenLM/Qwen3-TTS) — designed for making YouTube
narration. Everything runs **on your own machine**: no API keys, no cloud, no
per-character billing.

![local](https://img.shields.io/badge/runs-100%25%20local-e6a94b) ![gpu](https://img.shields.io/badge/NVIDIA-CUDA-76b900)

## What it does

- **Studio** — paste a whole script; it's split into sentences, rendered
  chunk-by-chunk, and stitched into one clean file with natural pauses.
- **9 built-in voices** across 10 languages, with **emotion / style control**
  in plain language ("warm and upbeat, like a documentary narrator").
- **Voice cloning** — upload 10–20s of a voice and narrate in it.
- **Voice design** — describe a voice in words and the model invents it.
- **YouTube-ready output** — loudness-normalized MP3/WAV, one-click download.
- **History** of every render.

## Requirements

- Windows, Python 3.11+, and [ffmpeg](https://ffmpeg.org/) on `PATH`
  (or at `C:\ffmpeg\ffmpeg.exe`).
- An **NVIDIA GPU** with the CUDA build of PyTorch (see `requirements.txt`).
  This machine runs a **GeForce RTX 5060 Ti (16 GB)** on CUDA 12.8 (cu128).
  No CUDA GPU? It falls back to the CPU automatically — same output, just slower.
- ~8 GB free disk per model (weights download on first use, into `./models`).

## Run it

```powershell
# from C:\QwenTTS
./run.ps1            # or double-click run.bat
```

Then open <http://127.0.0.1:8000>. The **first** time you use a voice mode it
downloads that model (a few GB) — after that it's instant to load.

### Manual start

```powershell
.\.venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8000
```

## Models

| Task | Model | Notes |
|------|-------|-------|
| Built-in voices | `Qwen3-TTS-12Hz-1.7B-CustomVoice` | 9 voices + emotion control |
| Voice design | `Qwen3-TTS-12Hz-1.7B-VoiceDesign` | describe-a-voice |
| Voice clone | `Qwen3-TTS-12Hz-1.7B-Base` | 3-second cloning |

Switch to the **0.6B** set in *Settings* for faster (lower-fidelity) renders;
note 0.6B has no emotion control or voice design.

## Performance

Synthesis speed is reported as **RTF** (real-time factor): RTF 0.5× means 1
minute of audio renders in ~30 seconds (lower is better). On a GPU like the
**RTX 5060 Ti** in bfloat16, synthesis typically runs faster than real time; on
the **CPU fallback** it's several times *slower* than real time.

- **0.6B**: fastest, good for drafts.
- **1.7B**: best quality.

Benchmark your own machine with `python tests/smoke.py 1.7B` — it prints the
load time and the measured RTF. Tune `Max chars / chunk` and pauses in
*Settings*.

## How it works

```
web/  (vanilla JS SPA)  ──►  FastAPI (app/main.py)
                               ├─ service.py   orchestration + background jobs
                               ├─ engine.py    qwen_tts model manager (LRU, CUDA/CPU)
                               ├─ chunking.py  sentence-aware splitting
                               └─ audio.py     ffmpeg stitch + loudnorm + mp3
third_party/Qwen3-TTS/   the official engine (installed editable)
models/                  downloaded weights (HF cache)
data/                    settings, history, custom voices, outputs
```

## Troubleshooting

- **"SoX could not be found"** — harmless; SoX is only used by an unused codec
  path. Ignore it.
- **"flash-attn is not installed"** — harmless; the model uses PyTorch's
  built-in SDPA attention. No flash-attn wheel is needed on Windows.
- **No MP3 / loudness** — install ffmpeg and make sure it's on `PATH`.
- **GPU not used / `torch.cuda.is_available()` is False** — you have a CPU-only
  PyTorch. Reinstall the CUDA build (RTX 50-series "Blackwell" needs cu128):
  `pip install torch==2.11.0 torchaudio==2.11.0 --index-url https://download.pytorch.org/whl/cu128`
  The *Settings → Compute device* row and the sidebar chip show what's active.
- **Out of memory (CUDA out of memory)** — lower *Models in RAM* to 1 in
  Settings, or switch to 0.6B. The 1.7B set in bfloat16 needs a few GB of VRAM
  per loaded task model.

## Credits

Built on [Qwen3-TTS](https://github.com/QwenLM/Qwen3-TTS) by the Alibaba Qwen
team (Apache-2.0). This studio wrapper is for local, personal content creation.
