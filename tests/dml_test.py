"""Test whether Qwen3-TTS runs on the AMD GPU via DirectML, and benchmark it.

Loads on CPU, moves the model to the DML device, synthesizes a line, and times
it. Any unsupported-operator error is printed clearly so we know exactly what
(if anything) blocks GPU execution.
"""
import sys
import time
import traceback

from app import config  # sets HF_HOME
import numpy as np
import soundfile as sf
import torch
import torch_directml
from qwen_tts import Qwen3TTSModel

SIZE = sys.argv[1] if len(sys.argv) > 1 else "1.7B"
DTYPE = {"float16": torch.float16, "fp16": torch.float16,
         "float32": torch.float32, "fp32": torch.float32}.get(
    (sys.argv[2] if len(sys.argv) > 2 else "float16").lower(), torch.float16)
repo = config.MODEL_REPOS[SIZE]["custom_voice"]

dev = torch_directml.device()
print(f"[dml] torch={torch.__version__} device={dev} dtype={DTYPE}", flush=True)

print(f"[dml] loading {repo} (cpu)…", flush=True)
t0 = time.time()
m = Qwen3TTSModel.from_pretrained(repo, dtype=DTYPE, attn_implementation=None)
print(f"[dml] loaded in {time.time() - t0:.1f}s; moving to GPU…", flush=True)

try:
    m.model.to(dev)
    m.device = dev
    print("[dml] model on GPU", flush=True)
except Exception as exc:
    print("[dml] MOVE FAILED:", repr(exc), flush=True)
    traceback.print_exc()
    sys.exit(2)

text = "Hey everyone, welcome back to the channel. This is running on my GPU."
print("[dml] synthesizing…", flush=True)
try:
    t1 = time.time()
    wavs, sr = m.generate_custom_voice(
        text=text, speaker="Ryan", language="English",
        do_sample=False, repetition_penalty=1.0,
        subtalker_dosample=False, max_new_tokens=400)
    dt = time.time() - t1
    dur = len(wavs[0]) / sr
    sf.write(str(config.OUTPUTS_DIR / f"dml_{SIZE}.wav"),
             np.asarray(wavs[0], dtype=np.float32), sr)
    print(f"[dml] SUCCESS: synth {dt:.1f}s for {dur:.1f}s audio  RTF {dt/max(dur,0.1):.2f}x",
          flush=True)
except Exception as exc:
    print("[dml] SYNTH FAILED:", repr(exc), flush=True)
    traceback.print_exc()
    sys.exit(3)
