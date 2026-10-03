# voice-lab API contract

The `voice-lab` container (Python 3.12, FastAPI, port 8000) does accurate offline analysis.
The `web` container calls it from its job queue. Both mount `./data` at `/data`, so audio is
passed by path, not uploaded.

## `GET /health`
`{"ok": true, "whisper_loaded": bool, "device": "cuda"|"cpu", "model": "large-v3-turbo"}`

## `POST /analyze`
Request (JSON):
```json
{
  "path": "/data/audio/abc.webm",          // any ffmpeg-readable audio
  "transcribe": true,                       // false = prosody only (warm-up glides)
  "language": "en",
  "f0_floor": 75, "f0_ceiling": 500,        // per-user clamp (Hz) to avoid octave errors
  "reference_path": "/data/audio/ref.webm", // optional: model-and-match DTW against this clip
  "initial_prompt": "Um, uh, like, you know." // optional Whisper prompt (keeps fillers in transcript)
}
```

Response (JSON). All pitch values are semitones (ST) relative to the clip's median F0
unless the name says `_hz`. Times are seconds.
```json
{
  "duration_s": 61.2,
  "language": "en",
  "text": "full transcript",
  "segments": [{"start": 0.0, "end": 4.1, "text": "..."}],
  "words": [
    {"w": "Hello,", "start": 0.12, "end": 0.48, "prob": 0.98,
     "f0_peak_st": 2.1, "f0_mean_st": 0.4, "db_mean": 64.2, "db_peak": 70.1, "voiced_frac": 0.8}
  ],
  "pitch": {
    "median_hz": 118.0,
    "st_sd": 2.3,                 // global SD of voiced F0 in ST
    "p5_st": -3.1, "p95_st": 4.2, "range_st": 7.3,
    "mean_abs_phrase_slope": 3.1, // ST/s, mean |slope| over phrases (voiced runs between >=250 ms pauses)
    "phrases": [{"start": 0.1, "end": 2.4, "slope_st_per_s": -1.2, "st_sd": 2.0}],
    "final_slope_st_per_s": 4.0,  // slope over the last 400 ms of voicing (question vs statement)
    "voicing_breaks": 3,          // unvoiced gaps 50-250 ms inside phrases
    "glide_breaks": 0             // frame-to-frame jumps > 1.5 ST between voiced frames
  },
  "intensity": {"db_mean": 62.0, "db_sd": 5.4},
  "contour": [[0.00, null], [0.02, 1.3]],   // [t, st|null] at 50 Hz (20 ms hop)
  "windows": [{"start": 0, "end": 10, "st_sd": 2.1, "db_sd": 4.8, "voiced_frac": 0.55}],
  "pauses": [{"start": 2.4, "end": 2.9}],   // silent (unvoiced + low intensity) gaps >= 250 ms
  "dtw": {                                   // only when reference_path given
    "similarity": 0.82,      // 0..1, 1 = identical shape (z-normalised ST contours)
    "range_ratio": 0.9,      // user p5-p95 range / reference range
    "peak_timing_diff": 0.05 // |relative position of max F0| difference, 0..1
  }
}
```
Errors: HTTP 4xx/5xx with `{"detail": "..."}`.

## Notes (as implemented)
- Any numeric value that can't be computed (no voicing, too few frames) is `null`, including pitch stats, `final_slope_st_per_s`, window `st_sd`, word F0 fields and `dtw` fields.
- 404 = file missing; 422 = undecodable audio, ceiling ≤ floor, or audio < 50 ms; 500 = analysis failure.
- `language: null` = auto-detect. With `transcribe: false`, `text` is `""` and `segments`/`words` are `[]`.
- Silence before the first / after the last voiced frame is not reported as a pause.
