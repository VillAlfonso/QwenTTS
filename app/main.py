"""FastAPI application: REST API + static SPA, bound to localhost."""
from __future__ import annotations

import threading
import time
from pathlib import Path
from typing import List, Optional

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from . import config, jobs, service, storage
from .audio import ffmpeg_ok
from .engine import engine
from .voices import DESIGN_PRESETS, LANGUAGES, SPEAKERS

app = FastAPI(title="Qwen3-TTS Studio", version="1.0.0")


@app.middleware("http")
async def _no_cache(request, call_next):
    """Local dev app: never let the browser serve stale HTML/CSS/JS."""
    response = await call_next(request)
    response.headers["Cache-Control"] = "no-store, max-age=0"
    return response


# --- request models --------------------------------------------------------
class TTSReq(BaseModel):
    mode: str = "custom"            # "custom" | "clone"
    text: str
    language: Optional[str] = None
    speaker: Optional[str] = None
    instruct: Optional[str] = None
    voice_id: Optional[str] = None
    preview: bool = False
    format: Optional[str] = None     # "mp3" | "wav" | "both"
    loudnorm: Optional[bool] = None


class DesignReq(BaseModel):
    name: Optional[str] = "Designed voice"
    instruct: str
    preview_text: Optional[str] = None
    language: Optional[str] = "English"


class PreloadReq(BaseModel):
    task: str


class ChunkReq(BaseModel):
    mode: str = "custom"            # "custom" | "clone"
    text: str
    language: Optional[str] = None
    speaker: Optional[str] = None
    voice_id: Optional[str] = None
    instruct: Optional[str] = None


class ExportChunk(BaseModel):
    file: str
    paragraph: int = 0
    text: Optional[str] = ""


class ExportReq(BaseModel):
    chunks: List[ExportChunk]
    title: Optional[str] = None
    voice: Optional[str] = None
    language: Optional[str] = None
    format: Optional[str] = None
    loudnorm: Optional[bool] = None


# --- helpers ---------------------------------------------------------------
def _voices_payload():
    return {
        "builtin": SPEAKERS,
        "languages": LANGUAGES,
        "custom": storage.get_custom_voices(),
        "design_presets": DESIGN_PRESETS,
    }


def _safe_output(name: str) -> Path:
    if "/" in name or "\\" in name or ".." in name:
        raise HTTPException(status_code=400, detail="bad filename")
    path = config.OUTPUTS_DIR / name
    if not path.exists():
        raise HTTPException(status_code=404, detail="not found")
    return path


# --- lifecycle -------------------------------------------------------------
@app.on_event("startup")
def _startup():
    jobs.start_worker()

    def _warm():
        try:
            engine.ensure_imports()
        except Exception:
            pass

    threading.Thread(target=_warm, name="warm-imports", daemon=True).start()


# --- API: state ------------------------------------------------------------
@app.get("/api/bootstrap")
def bootstrap():
    return {
        "status": _status_payload(),
        "settings": storage.get_settings(),
        "voices": _voices_payload(),
        "history": storage.get_history(),
    }


def _status_payload():
    st = engine.status()
    st["ffmpeg"] = ffmpeg_ok()
    return st


@app.get("/api/status")
def status():
    return _status_payload()


@app.get("/api/settings")
def get_settings():
    return storage.get_settings()


@app.put("/api/settings")
def put_settings(patch: dict):
    return storage.save_settings(patch or {})


@app.get("/api/voices")
def voices():
    return _voices_payload()


# --- API: synthesis --------------------------------------------------------
@app.post("/api/tts")
def tts(req: TTSReq):
    try:
        job_id = service.submit_tts(req.model_dump())
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    return {"job_id": job_id}


@app.post("/api/design")
def design(req: DesignReq):
    try:
        job_id = service.submit_design(req.model_dump())
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    return {"job_id": job_id}


@app.post("/api/chunk")
def chunk(req: ChunkReq):
    try:
        return {"job_id": service.submit_chunk(req.model_dump())}
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@app.post("/api/export")
def export_render(req: ExportReq):
    try:
        return {"job_id": service.submit_export(req.model_dump())}
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@app.post("/api/preload")
def preload(req: PreloadReq):
    return {"job_id": service.submit_preload(req.task)}


@app.get("/api/jobs/{job_id}")
def job_status(job_id: str):
    job = jobs.get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="job not found")
    return job


# --- API: voices (clone / delete) -----------------------------------------
@app.post("/api/voices/clone")
async def clone_voice(
    file: UploadFile = File(...),
    name: str = Form("My voice"),
    ref_text: str = Form(""),
    language: str = Form("Auto"),
):
    suffix = Path(file.filename or "sample.wav").suffix or ".wav"
    tmp = config.REFS_DIR / f"upload_{storage.new_id()}{suffix}"
    data = await file.read()
    tmp.write_bytes(data)
    try:
        voice = service.register_clone(name, str(tmp), ref_text, language)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=400, detail=f"Could not process audio: {exc}")
    finally:
        try:
            tmp.unlink()
        except OSError:
            pass
    return {"voice": voice}


@app.delete("/api/voices/{voice_id}")
def delete_voice(voice_id: str):
    voice = storage.get_custom_voice(voice_id)
    if voice:
        for key in ("ref_audio_path",):
            p = voice.get(key)
            if p:
                try:
                    Path(p).unlink()
                except OSError:
                    pass
    ok = storage.delete_custom_voice(voice_id)
    return {"deleted": ok}


# --- API: history ----------------------------------------------------------
@app.get("/api/history")
def history():
    return storage.get_history()


@app.delete("/api/history/{item_id}")
def delete_history(item_id: str):
    return {"deleted": storage.delete_history(item_id)}


# --- file serving ----------------------------------------------------------
@app.get("/download/{name}")
def download(name: str):
    path = _safe_output(name)
    return FileResponse(str(path), filename=name)


@app.exception_handler(HTTPException)
async def _http_exc(request, exc: HTTPException):
    return JSONResponse(status_code=exc.status_code, content={"detail": exc.detail})


# Generated audio (inline playback) then the SPA. Mounted last so /api wins.
app.mount("/audio", StaticFiles(directory=str(config.OUTPUTS_DIR)), name="audio")
app.mount("/", StaticFiles(directory=str(config.WEB_DIR), html=True), name="web")
