# Qwen3-TTS Studio 🎙️

A local, private, **human-sounding** text-to-speech studio built on
[Qwen3-TTS](https://github.com/QwenLM/Qwen3-TTS) — designed for making YouTube
narration. Everything runs **on your own machine**: no API keys, no cloud, no
per-character billing.

![local](https://img.shields.io/badge/runs-100%25%20local-e6a94b) ![cpu](https://img.shields.io/badge/CPU-friendly-57d2c4)

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
- ~8 GB free disk per model (weights download on first use, into `./models`).

This machine has an **AMD GPU**, and PyTorch's GPU acceleration (ROCm) is
Linux-only — so synthesis runs on the **CPU** by default. It works well; it's
just slower than real-time. See *Performance* below.

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

Synthesis speed is reported as **RTF** (real-time factor): RTF 5× means 1 minute
of audio takes ~5 minutes to render. On an 8-core CPU expect roughly:

- **0.6B**: fastest, good for drafts.
- **1.7B**: best quality, slower.

Render long scripts and grab a coffee — or draft with 0.6B and do the final
pass with 1.7B. Tune `Max chars / chunk` and pauses in *Settings*.

## How it works

```
web/  (vanilla JS SPA)  ──►  FastAPI (app/main.py)
                               ├─ service.py   orchestration + background jobs
                               ├─ engine.py    qwen_tts model manager (LRU, CPU)
                               ├─ chunking.py  sentence-aware splitting
                               └─ audio.py     ffmpeg stitch + loudnorm + mp3
third_party/Qwen3-TTS/   the official engine (installed editable)
models/                  downloaded weights (HF cache)
data/                    settings, history, custom voices, outputs
```

## Troubleshooting

- **"SoX could not be found"** — harmless; SoX is only used by an unused codec
  path. Ignore it.
- **"flash-attn is not installed"** — expected on CPU; it uses the PyTorch path.
- **No MP3 / loudness** — install ffmpeg and make sure it's on `PATH`.
- **Out of memory** — lower *Models in RAM* to 1 in Settings, or use 0.6B.
- **AMD GPU (DirectML)** — tested and **not viable**: DirectML can't run
  Qwen3-TTS's token-generation loop (it lacks int64 ops like `gather`/`cat` on
  token IDs), so synthesis runs on the CPU. The isolated `.venv-dml` created for
  that experiment can be deleted to reclaim space.

## Credits

Built on [Qwen3-TTS](https://github.com/QwenLM/Qwen3-TTS) by the Alibaba Qwen
team (Apache-2.0). This studio wrapper is for local, personal content creation.
