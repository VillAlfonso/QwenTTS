"""Check whether the Base (clone) model responds to an instruction/style prompt
now that the wrapper threads `instruct` through. Renders the same line on the
cloned voice with no instruct vs angry vs sad and reports duration/energy."""
import time

from app import config
import numpy as np
import soundfile as sf
import torch
from qwen_tts import Qwen3TTSModel

repo = config.MODEL_REPOS["1.7B"]["base"]
print("loading", repo, flush=True)
m = Qwen3TTSModel.from_pretrained(repo, device_map="cpu", dtype=torch.float32,
                                  attn_implementation=None)

ref = str(config.REFS_DIR / "selftest_ref.wav")
ref_text = ("The quick brown fox jumps over the lazy dog while the morning "
            "light spills across the quiet valley below.")
text = "I absolutely cannot believe you actually did that, it is unbelievable."

prompt = m.create_voice_clone_prompt(ref_audio=ref, ref_text=ref_text)

for tag, ins in [("neutral", None),
                 ("angry", "Speak in a furious, shouting, angry tone."),
                 ("sad", "Speak in a slow, sad, subdued, crying tone.")]:
    t = time.time()
    wavs, sr = m.generate_voice_clone(text=text, language="English",
                                      voice_clone_prompt=prompt, instruct=ins)
    arr = np.asarray(wavs[0], dtype=np.float32)
    dur = len(arr) / sr
    rms = float(np.sqrt(np.mean(arr ** 2)))
    sf.write(str(config.OUTPUTS_DIR / f"clone_tone_{tag}.wav"), arr, sr)
    print(f"  {tag:8s}: {dur:4.1f}s  rms {rms:.4f}  ({time.time()-t:.0f}s)", flush=True)

print("DONE", flush=True)
