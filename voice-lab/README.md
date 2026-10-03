# voice-lab

Offline speech analysis for Yapp: faster-whisper transcription with word timestamps
plus Praat (parselmouth) prosody — F0 in semitones, intensity, pauses, phrases,
per-word prosody, 10 s windows, a 50 Hz contour and DTW model-and-match scoring.
API contract: [`../docs/voice-lab-api.md`](../docs/voice-lab-api.md).

- `prosody.py` — pure analysis functions (numpy + parselmouth only).
- `app.py` — FastAPI app (`GET /health`, `POST /analyze`); Whisper is loaded lazily on
  the first transcription and GPU work is serialised with a lock.

## Tests

Tests use synthetic signals and a fake transcriber, so no model download or GPU is needed.
`ffmpeg` must be on `PATH`.

```sh
uv venv .venv -p 3.12
uv pip install --python .venv/bin/python -r requirements.txt
.venv/bin/pytest -q
```

## Run locally

```sh
WHISPER_MODEL=base WHISPER_CACHE=./models .venv/bin/uvicorn app:app --port 8000
curl -s localhost:8000/health
curl -s localhost:8000/analyze -H 'content-type: application/json' \
  -d '{"path": "/abs/path/clip.webm", "language": "en"}'
```

## Docker

```sh
docker build -t yapp-voice-lab .
docker run --rm --gpus all -p 8000:8000 -v "$PWD/../data:/data" yapp-voice-lab
```

## Configuration

| Env | Default | |
|---|---|---|
| `WHISPER_MODEL` | `large-v3-turbo` | any faster-whisper model name or path |
| `WHISPER_DEVICE` | `auto` | `auto` picks `cuda` when available, else `cpu` |
| `WHISPER_COMPUTE_TYPE` | `float16` on cuda, `int8` on cpu | |
| `WHISPER_CACHE` | `/data/models` | model download directory |

## Notes on the numbers

- Pitch: Praat autocorrelation (`to_pitch_ac`), 10 ms hop, clamped to the request's
  `f0_floor`/`f0_ceiling`. ST are relative to the clip's median voiced F0.
- Pauses: frames that are unvoiced **and** below an adaptive intensity threshold
  (midway between the noise floor and the speech level, bounded to 10–25 dB below speech),
  lasting ≥ 250 ms, between the first and last voiced frame. Leading/trailing silence is
  not a pause.
- Word `f0_peak_st` is taken from a 5-frame median-filtered track, which resists
  single-frame octave errors.
- DTW: voiced frames only, each contour is resampled to 100 points and z-normalised.
  The DTW uses a 10% Sakoe-Chiba band, and the similarity is `exp(-mean |Δz|)`.
- Values that cannot be computed (e.g. pitch stats on a clip with no voicing) are `null`.
