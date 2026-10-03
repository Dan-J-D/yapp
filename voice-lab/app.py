"""voice-lab: offline speech analysis service (Whisper + Praat prosody).

See docs/voice-lab-api.md for the contract.
"""

from __future__ import annotations

import logging
import os
import threading
from typing import Any

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

import prosody

log = logging.getLogger("voice-lab")

DEFAULT_PROMPT = "Um, uh, so, like, you know, I mean, hmm."


def _resolve_device(requested: str) -> str:
    if requested and requested != "auto":
        return requested
    try:
        import ctranslate2

        return "cuda" if ctranslate2.get_cuda_device_count() > 0 else "cpu"
    except Exception:
        return "cpu"


class WhisperTranscriber:
    """Lazily loads faster-whisper once; serialises all GPU work with a lock."""

    def __init__(self) -> None:
        self.model_name = os.environ.get("WHISPER_MODEL", "large-v3-turbo")
        self.cache_dir = os.environ.get("WHISPER_CACHE", "/data/models")
        self._device_req = os.environ.get("WHISPER_DEVICE", "auto")
        self._device: str | None = None
        self._model = None
        self._lock = threading.Lock()

    @property
    def device(self) -> str:
        if self._device is None:
            self._device = _resolve_device(self._device_req)
        return self._device

    @property
    def loaded(self) -> bool:
        return self._model is not None

    def _load(self):
        if self._model is None:
            from faster_whisper import WhisperModel

            compute_type = os.environ.get(
                "WHISPER_COMPUTE_TYPE", "float16" if self.device == "cuda" else "int8"
            )
            log.info("loading whisper %s on %s (%s)", self.model_name, self.device, compute_type)
            self._model = WhisperModel(
                self.model_name,
                device=self.device,
                compute_type=compute_type,
                download_root=self.cache_dir,
            )
        return self._model

    def transcribe(self, audio, language: str | None, initial_prompt: str | None) -> dict:
        """audio: mono float32 numpy array at 16 kHz."""
        with self._lock:
            model = self._load()
            segments, info = model.transcribe(
                audio,
                language=language or None,
                word_timestamps=True,
                vad_filter=False,
                condition_on_previous_text=False,
                initial_prompt=initial_prompt or None,
            )
            segs, words = [], []
            for s in segments:  # generator: decoding happens here, inside the lock
                segs.append({"start": round(s.start, 2), "end": round(s.end, 2),
                             "text": s.text.strip()})
                for w in s.words or []:
                    words.append({"w": w.word.strip(), "start": round(w.start, 2),
                                  "end": round(w.end, 2), "prob": round(w.probability, 3)})
        text = " ".join(s["text"] for s in segs).strip()
        return {"language": info.language, "text": text, "segments": segs, "words": words}


transcriber = WhisperTranscriber()

app = FastAPI(title="voice-lab", version="1.0.0")


class AnalyzeRequest(BaseModel):
    path: str
    transcribe: bool = True
    language: str | None = "en"
    f0_floor: float = Field(75.0, gt=20, lt=1000)
    f0_ceiling: float = Field(500.0, gt=40, le=2000)
    reference_path: str | None = None
    initial_prompt: str | None = None


@app.get("/health")
def health() -> dict:
    return {
        "ok": True,
        "whisper_loaded": transcriber.loaded,
        "device": transcriber.device,
        "model": transcriber.model_name,
    }


def _load(path: str):
    try:
        return prosody.load_audio(path)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail=f"audio not found: {path}")
    except prosody.AudioDecodeError as e:
        raise HTTPException(status_code=422, detail=f"cannot decode {path}: {e}")


# Plain `def` endpoint: FastAPI runs it in its threadpool, so blocking
# decode/Praat/Whisper work never stalls the event loop.
@app.post("/analyze")
def analyze(req: AnalyzeRequest) -> dict[str, Any]:
    if req.f0_ceiling <= req.f0_floor:
        raise HTTPException(status_code=422, detail="f0_ceiling must be greater than f0_floor")
    snd = _load(req.path)
    if snd.duration < 0.05:
        raise HTTPException(status_code=422, detail="audio too short")

    tx = {"language": req.language, "text": "", "segments": [], "words": []}
    if req.transcribe:
        try:
            tx = transcriber.transcribe(
                prosody.sound_samples(snd), req.language,
                req.initial_prompt if req.initial_prompt is not None else DEFAULT_PROMPT,
            )
        except Exception as e:
            log.exception("transcription failed")
            raise HTTPException(status_code=500, detail=f"transcription failed: {e}")

    try:
        tracks = prosody.compute_tracks(snd, req.f0_floor, req.f0_ceiling)
        res = prosody.analyze_tracks(tracks, tx["words"])
    except Exception as e:
        log.exception("prosody failed")
        raise HTTPException(status_code=500, detail=f"prosody analysis failed: {e}")
    user_st = res.pop("_st")

    out: dict[str, Any] = {
        "duration_s": res["duration_s"],
        "language": tx["language"],
        "text": tx["text"],
        "segments": tx["segments"],
        "words": res["words"],
        "pitch": res["pitch"],
        "intensity": res["intensity"],
        "contour": res["contour"],
        "windows": res["windows"],
        "pauses": res["pauses"],
    }

    if req.reference_path:
        ref = _load(req.reference_path)
        ref_tracks = prosody.compute_tracks(ref, req.f0_floor, req.f0_ceiling)
        ref_st, _ = prosody.st_track(ref_tracks.f0_hz)
        out["dtw"] = prosody.compare_contours(user_st, ref_st)
    return out
