"""Prosody analysis: pure functions over numpy arrays and parselmouth Sounds.

No FastAPI or Whisper imports here so everything is unit-testable.

Conventions:
- Pitch is analysed on a 10 ms frame grid (``FRAME_STEP``). Unvoiced frames are NaN.
- Pitch values are semitones (ST) relative to the clip's median voiced F0.
- Intensity is in dB (Praat's intensity, re 2e-5 Pa), sampled on the pitch grid.
- Times are seconds.
"""

from __future__ import annotations

import math
import os
import subprocess
from dataclasses import dataclass

import numpy as np
import parselmouth

SAMPLE_RATE = 16000
FRAME_STEP = 0.01  # 10 ms analysis hop
CONTOUR_STEP = 0.02  # 50 Hz output contour
MIN_PAUSE_S = 0.25
VOICING_BREAK_MIN_S = 0.05
GLIDE_BREAK_ST = 1.5
FINAL_SLOPE_S = 0.4
WINDOW_S = 10.0
MIN_PHRASE_VOICED_FRAMES = 5


class AudioDecodeError(RuntimeError):
    pass


# --------------------------------------------------------------------------- audio


def decode_with_ffmpeg(path: str, sr: int = SAMPLE_RATE) -> np.ndarray:
    """Decode any ffmpeg-readable file to mono float32 at ``sr``."""
    cmd = [
        "ffmpeg", "-nostdin", "-v", "error", "-i", path,
        "-vn", "-ac", "1", "-ar", str(sr), "-f", "f32le", "-acodec", "pcm_f32le", "-",
    ]
    try:
        proc = subprocess.run(cmd, capture_output=True, check=False)
    except FileNotFoundError as e:  # pragma: no cover - env problem
        raise AudioDecodeError("ffmpeg not found") from e
    if proc.returncode != 0:
        msg = proc.stderr.decode("utf-8", "replace").strip().splitlines()
        raise AudioDecodeError(f"ffmpeg failed: {msg[-1] if msg else 'unknown error'}")
    return np.frombuffer(proc.stdout, dtype=np.float32).copy()


def load_audio(path: str, sr: int = SAMPLE_RATE) -> parselmouth.Sound:
    """Load audio as a mono parselmouth Sound at ``sr`` Hz.

    WAV files are read directly by Praat; anything else (or a WAV Praat can't
    read) is decoded by ffmpeg.
    """
    if not os.path.isfile(path):
        raise FileNotFoundError(path)
    snd = None
    if path.lower().endswith(".wav"):
        try:
            snd = parselmouth.Sound(path)
            if snd.n_channels > 1:
                snd = snd.convert_to_mono()
            if int(round(snd.sampling_frequency)) != sr:
                snd = snd.resample(sr)
        except Exception:
            snd = None
    if snd is None:
        samples = decode_with_ffmpeg(path, sr)
        if samples.size == 0:
            raise AudioDecodeError("no audio samples decoded")
        snd = parselmouth.Sound(samples.astype(np.float64), sampling_frequency=sr)
    return snd


def sound_samples(snd: parselmouth.Sound) -> np.ndarray:
    """Mono float32 samples (what Whisper wants at 16 kHz)."""
    return np.asarray(snd.values[0], dtype=np.float32)


# --------------------------------------------------------------------------- tracks


@dataclass
class Tracks:
    t: np.ndarray  # frame centre times (s)
    f0_hz: np.ndarray  # NaN when unvoiced
    db: np.ndarray  # intensity on the same grid
    duration: float

    @property
    def voiced(self) -> np.ndarray:
        return ~np.isnan(self.f0_hz)


def compute_pitch(snd: parselmouth.Sound, f0_floor: float = 75.0, f0_ceiling: float = 500.0,
                  time_step: float = FRAME_STEP) -> tuple[np.ndarray, np.ndarray]:
    """F0 track via Praat's autocorrelation method. Returns (times, f0_hz with NaN unvoiced)."""
    pitch = snd.to_pitch_ac(time_step=time_step, pitch_floor=f0_floor, pitch_ceiling=f0_ceiling)
    t = np.asarray(pitch.xs(), dtype=float)
    f0 = np.asarray(pitch.selected_array["frequency"], dtype=float)
    f0[f0 <= 0] = np.nan
    return t, f0


def compute_intensity(snd: parselmouth.Sound, f0_floor: float = 75.0,
                      time_step: float = FRAME_STEP) -> tuple[np.ndarray, np.ndarray]:
    """Intensity contour (dB). Returns (times, db)."""
    inten = snd.to_intensity(minimum_pitch=f0_floor, time_step=time_step, subtract_mean=False)
    t = np.asarray(inten.xs(), dtype=float)
    db = np.asarray(inten.values[0], dtype=float)
    # Praat reports -300 dB (or similar) for digital silence; clamp to something sane.
    db = np.where(np.isfinite(db), db, 0.0)
    db = np.maximum(db, 0.0)
    return t, db


def compute_tracks(snd: parselmouth.Sound, f0_floor: float = 75.0,
                   f0_ceiling: float = 500.0) -> Tracks:
    t, f0 = compute_pitch(snd, f0_floor, f0_ceiling)
    ti, db = compute_intensity(snd, f0_floor)
    if ti.size == 0:
        db_on_grid = np.zeros_like(t)
    else:
        db_on_grid = np.interp(t, ti, db)
    return Tracks(t=t, f0_hz=f0, db=db_on_grid, duration=float(snd.duration))


def hz_to_st(f0_hz: np.ndarray, ref_hz: float) -> np.ndarray:
    return 12.0 * np.log2(np.asarray(f0_hz, dtype=float) / ref_hz)


def median_f0(f0_hz: np.ndarray) -> float | None:
    v = f0_hz[~np.isnan(f0_hz)]
    return float(np.median(v)) if v.size else None


def st_track(f0_hz: np.ndarray) -> tuple[np.ndarray, float | None]:
    """ST relative to the median voiced F0 (NaN where unvoiced)."""
    med = median_f0(f0_hz)
    if med is None:
        return np.full_like(f0_hz, np.nan, dtype=float), None
    return hz_to_st(f0_hz, med), med


# --------------------------------------------------------------------------- helpers


def _runs(mask: np.ndarray) -> list[tuple[int, int]]:
    """Inclusive (start, end) index pairs of True runs."""
    mask = np.asarray(mask, dtype=bool)
    if mask.size == 0:
        return []
    d = np.diff(np.concatenate(([0], mask.astype(np.int8), [0])))
    starts = np.flatnonzero(d == 1)
    ends = np.flatnonzero(d == -1) - 1
    return list(zip(starts.tolist(), ends.tolist()))


def _slope(t: np.ndarray, y: np.ndarray) -> float | None:
    if t.size < 2 or np.ptp(t) <= 0:
        return None
    return float(np.polyfit(t, y, 1)[0])


def _median_filter(x: np.ndarray, k: int = 5) -> np.ndarray:
    if x.size < k or k < 2:
        return x.copy()
    half = k // 2
    padded = np.pad(x, half, mode="edge")
    win = np.lib.stride_tricks.sliding_window_view(padded, k)
    return np.median(win, axis=1)


def _r(x: float | None, nd: int = 2) -> float | None:
    if x is None:
        return None
    x = float(x)
    if not math.isfinite(x):
        return None
    return round(x, nd)


def _sd(x: np.ndarray) -> float | None:
    return float(np.std(x)) if x.size >= 2 else None


# --------------------------------------------------------------------------- stats


def pitch_stats(st: np.ndarray) -> dict:
    """Global stats over voiced ST values."""
    v = st[~np.isnan(st)]
    if v.size < 2:
        return {"st_sd": None, "p5_st": None, "p95_st": None, "range_st": None}
    p5, p95 = np.percentile(v, [5, 95])
    return {"st_sd": float(np.std(v)), "p5_st": float(p5), "p95_st": float(p95),
            "range_st": float(p95 - p5)}


def silence_threshold(db: np.ndarray, voiced: np.ndarray) -> float:
    """Adaptive silence threshold (dB).

    Midway between the noise floor (p5) and the speech level (p95 of voiced
    frames), but never more than 25 dB below speech and never closer than
    10 dB to it.
    """
    if db.size == 0:
        return 0.0
    speech = float(np.percentile(db[voiced], 95)) if voiced.any() else float(np.percentile(db, 95))
    noise = float(np.percentile(db, 5))
    thr = max(speech - 25.0, noise + 0.5 * (speech - noise))
    return min(thr, speech - 10.0)


def detect_pauses(t: np.ndarray, voiced: np.ndarray, db: np.ndarray,
                  min_pause: float = MIN_PAUSE_S, step: float = FRAME_STEP,
                  threshold: float | None = None) -> list[tuple[float, float]]:
    """Silent gaps (unvoiced AND below the adaptive intensity threshold) >= ``min_pause``.

    Only gaps between the first and last voiced frame count (leading and
    trailing silence are not pauses).
    """
    if t.size == 0 or not voiced.any():
        return []
    thr = silence_threshold(db, voiced) if threshold is None else threshold
    silent = (~voiced) & (db < thr)
    vidx = np.flatnonzero(voiced)
    first, last = vidx[0], vidx[-1]
    pauses = []
    for s, e in _runs(silent):
        if s <= first or e >= last:
            continue
        start, end = t[s] - step / 2, t[e] + step / 2
        if end - start >= min_pause - 1e-9:
            pauses.append((float(start), float(end)))
    return pauses


def phrase_spans(t: np.ndarray, voiced: np.ndarray,
                 pauses: list[tuple[float, float]]) -> list[tuple[int, int]]:
    """Index spans (first voiced, last voiced) of the voiced stretches between pauses."""
    if not voiced.any():
        return []
    bounds = [-np.inf] + [p for pause in pauses for p in pause] + [np.inf]
    spans = []
    for i in range(0, len(bounds), 2):
        lo, hi = bounds[i], bounds[i + 1]
        idx = np.flatnonzero(voiced & (t > lo) & (t < hi))
        if idx.size:
            spans.append((int(idx[0]), int(idx[-1])))
    return spans


def phrase_stats(t: np.ndarray, st: np.ndarray, spans: list[tuple[int, int]]) -> list[dict]:
    out = []
    for s, e in spans:
        tt, yy = t[s:e + 1], st[s:e + 1]
        m = ~np.isnan(yy)
        if m.sum() < MIN_PHRASE_VOICED_FRAMES:
            continue
        out.append({
            "start": float(tt[m][0]),
            "end": float(tt[m][-1]),
            "slope_st_per_s": _slope(tt[m], yy[m]),
            "st_sd": _sd(yy[m]),
        })
    return out


def final_slope(t: np.ndarray, st: np.ndarray, span_s: float = FINAL_SLOPE_S) -> float | None:
    """Slope (ST/s) of the last ``span_s`` seconds of voicing."""
    m = ~np.isnan(st)
    if m.sum() < 3:
        return None
    t_end = t[m][-1]
    sel = m & (t >= t_end - span_s)
    if sel.sum() < 3:
        return None
    return _slope(t[sel], st[sel])


def count_voicing_breaks(voiced: np.ndarray, spans: list[tuple[int, int]],
                         step: float = FRAME_STEP, min_s: float = VOICING_BREAK_MIN_S,
                         max_s: float = MIN_PAUSE_S) -> int:
    """Unvoiced gaps of min_s..max_s inside phrases."""
    n = 0
    for s, e in spans:
        for a, b in _runs(~voiced[s:e + 1]):
            dur = (b - a + 1) * step
            if min_s - 1e-9 <= dur < max_s - 1e-9:
                n += 1
    return n


def count_glide_breaks(st: np.ndarray, jump_st: float = GLIDE_BREAK_ST) -> int:
    """Frame-to-frame jumps larger than ``jump_st`` between adjacent voiced frames."""
    if st.size < 2:
        return 0
    d = np.abs(np.diff(st))
    return int(np.sum(np.nan_to_num(d, nan=0.0) > jump_st))


def windows_stats(t: np.ndarray, st: np.ndarray, db: np.ndarray, voiced: np.ndarray,
                  silent_thr: float, duration: float, win: float = WINDOW_S) -> list[dict]:
    out = []
    start = 0.0
    while start < duration - 1e-9:
        end = min(start + win, duration)
        sel = (t >= start) & (t < end)
        v = st[sel & voiced]
        speech = sel & (voiced | (db >= silent_thr))
        nsel = int(sel.sum())
        out.append({
            "start": _r(start), "end": _r(end),
            "st_sd": _r(_sd(v) if v.size >= MIN_PHRASE_VOICED_FRAMES else None),
            "db_sd": _r(_sd(db[speech])),
            "voiced_frac": _r((sel & voiced).sum() / nsel if nsel else 0.0, 3),
        })
        start += win
    return out


def contour(t: np.ndarray, st: np.ndarray, duration: float,
            step: float = CONTOUR_STEP) -> list[list]:
    """[[t, st|null], ...] resampled to ``step`` by nearest analysis frame."""
    if t.size == 0:
        return []
    frame = float(np.median(np.diff(t))) if t.size > 1 else FRAME_STEP
    out = []
    n = int(math.floor(duration / step + 1e-9)) + 1
    for i in range(n):
        tc = i * step
        if tc > duration + 1e-9:
            break
        j = int(round((tc - t[0]) / frame))
        val = None
        if 0 <= j < t.size and abs(t[j] - tc) <= frame and not np.isnan(st[j]):
            val = round(float(st[j]), 2)
        out.append([round(tc, 2), val])
    return out


def word_prosody(t: np.ndarray, st: np.ndarray, db: np.ndarray,
                 words: list[dict]) -> list[dict]:
    """Per-word F0/intensity given word timestamps (dicts with ``start``/``end``).

    Returns new dicts with the original keys plus f0_peak_st, f0_mean_st,
    db_mean, db_peak, voiced_frac. The F0 peak is taken from a 5-frame median
    filtered track to resist single-frame octave errors.
    """
    smooth = st.copy()
    m_all = ~np.isnan(st)
    if m_all.any():
        smooth[m_all] = _median_filter(st[m_all], 5)
    out = []
    for w in words:
        sel = (t >= w["start"]) & (t <= w["end"])
        nsel = int(sel.sum())
        vm = sel & m_all
        res = dict(w)
        res["f0_peak_st"] = _r(float(np.max(smooth[vm]))) if vm.any() else None
        res["f0_mean_st"] = _r(float(np.mean(st[vm]))) if vm.any() else None
        res["db_mean"] = _r(float(np.mean(db[sel]))) if nsel else None
        res["db_peak"] = _r(float(np.max(db[sel]))) if nsel else None
        res["voiced_frac"] = _r(vm.sum() / nsel, 3) if nsel else 0.0
        out.append(res)
    return out


# --------------------------------------------------------------------------- DTW


def znorm(x: np.ndarray) -> np.ndarray:
    x = np.asarray(x, dtype=float)
    sd = x.std()
    return (x - x.mean()) / sd if sd > 1e-6 else x - x.mean()


def resample_linear(x: np.ndarray, n: int) -> np.ndarray:
    x = np.asarray(x, dtype=float)
    if x.size == n:
        return x.copy()
    if x.size == 1:
        return np.full(n, x[0])
    return np.interp(np.linspace(0, x.size - 1, n), np.arange(x.size), x)


def dtw_distance(a: np.ndarray, b: np.ndarray, band: int | None = None) -> float:
    """DTW with a Sakoe-Chiba band; returns path cost / path length (mean |a-b|)."""
    a = np.asarray(a, dtype=float)
    b = np.asarray(b, dtype=float)
    n, m = a.size, b.size
    if n == 0 or m == 0:
        return float("inf")
    if band is None:
        band = max(n, m)
    band = max(band, abs(n - m))
    inf = np.inf
    cost = np.full((n + 1, m + 1), inf)
    steps = np.zeros((n + 1, m + 1))
    cost[0, 0] = 0.0
    for i in range(1, n + 1):
        jlo = max(1, i - band)
        jhi = min(m, i + band)
        for j in range(jlo, jhi + 1):
            d = abs(a[i - 1] - b[j - 1])
            # choose best predecessor
            c_diag, c_up, c_left = cost[i - 1, j - 1], cost[i - 1, j], cost[i, j - 1]
            if c_diag <= c_up and c_diag <= c_left:
                cost[i, j] = c_diag + d
                steps[i, j] = steps[i - 1, j - 1] + 1
            elif c_up <= c_left:
                cost[i, j] = c_up + d
                steps[i, j] = steps[i - 1, j] + 1
            else:
                cost[i, j] = c_left + d
                steps[i, j] = steps[i, j - 1] + 1
    if not np.isfinite(cost[n, m]):
        return float("inf")
    return float(cost[n, m] / steps[n, m])


def dtw_similarity(user_st: np.ndarray, ref_st: np.ndarray, n: int = 100,
                   band_frac: float = 0.1) -> float | None:
    """Shape similarity 0..1 between two ST contours (NaNs = unvoiced, dropped).

    Both voiced contours are z-normalised and resampled to ``n`` points (so a
    uniform tempo difference costs nothing), then aligned by banded DTW. The
    mean absolute z-distance d maps to similarity exp(-d).
    """
    a = np.asarray(user_st, dtype=float)
    b = np.asarray(ref_st, dtype=float)
    a, b = a[~np.isnan(a)], b[~np.isnan(b)]
    if a.size < 2 or b.size < 2:
        return None
    a = znorm(resample_linear(a, n))
    b = znorm(resample_linear(b, n))
    d = dtw_distance(a, b, band=max(1, int(round(band_frac * n))))
    return float(math.exp(-d))


def range_ratio(user_st: np.ndarray, ref_st: np.ndarray) -> float | None:
    u, r = pitch_stats(np.asarray(user_st, float)), pitch_stats(np.asarray(ref_st, float))
    if u["range_st"] is None or r["range_st"] is None or r["range_st"] < 1e-6:
        return None
    return u["range_st"] / r["range_st"]


def peak_position(st: np.ndarray) -> float | None:
    """Relative position (0..1) of max F0 within the voiced extent."""
    st = np.asarray(st, dtype=float)
    idx = np.flatnonzero(~np.isnan(st))
    if idx.size < 2:
        return None
    smooth = _median_filter(st[idx], 5)
    k = idx[int(np.argmax(smooth))]
    return float((k - idx[0]) / (idx[-1] - idx[0]))


def peak_timing_diff(user_st: np.ndarray, ref_st: np.ndarray) -> float | None:
    pu, pr = peak_position(user_st), peak_position(ref_st)
    if pu is None or pr is None:
        return None
    return abs(pu - pr)


def compare_contours(user_st: np.ndarray, ref_st: np.ndarray) -> dict:
    return {
        "similarity": _r(dtw_similarity(user_st, ref_st), 3),
        "range_ratio": _r(range_ratio(user_st, ref_st), 3),
        "peak_timing_diff": _r(peak_timing_diff(user_st, ref_st), 3),
    }


# --------------------------------------------------------------------------- top level


def analyze_tracks(tr: Tracks, words: list[dict] | None = None) -> dict:
    """Everything except transcription and DTW. Returns contract-shaped dict parts."""
    st, med = st_track(tr.f0_hz)
    voiced = tr.voiced
    thr = silence_threshold(tr.db, voiced)
    pauses = detect_pauses(tr.t, voiced, tr.db, threshold=thr)
    spans = phrase_spans(tr.t, voiced, pauses)
    phrases = phrase_stats(tr.t, st, spans)
    stats = pitch_stats(st)
    slopes = [abs(p["slope_st_per_s"]) for p in phrases if p["slope_st_per_s"] is not None]
    speech = voiced | (tr.db >= thr)
    db_speech = tr.db[speech] if speech.any() else tr.db

    pitch = {
        "median_hz": _r(med),
        "st_sd": _r(stats["st_sd"]),
        "p5_st": _r(stats["p5_st"]),
        "p95_st": _r(stats["p95_st"]),
        "range_st": _r(stats["range_st"]),
        "mean_abs_phrase_slope": _r(float(np.mean(slopes)) if slopes else None),
        "phrases": [
            {"start": _r(p["start"]), "end": _r(p["end"]),
             "slope_st_per_s": _r(p["slope_st_per_s"]), "st_sd": _r(p["st_sd"])}
            for p in phrases
        ],
        "final_slope_st_per_s": _r(final_slope(tr.t, st)),
        "voicing_breaks": count_voicing_breaks(voiced, spans),
        "glide_breaks": count_glide_breaks(st),
    }
    return {
        "duration_s": _r(tr.duration, 3),
        "pitch": pitch,
        "intensity": {
            "db_mean": _r(float(np.mean(db_speech)) if db_speech.size else None),
            "db_sd": _r(_sd(db_speech)),
        },
        "contour": contour(tr.t, st, tr.duration),
        "windows": windows_stats(tr.t, st, tr.db, voiced, thr, tr.duration),
        "pauses": [{"start": _r(s), "end": _r(e)} for s, e in pauses],
        "words": word_prosody(tr.t, st, tr.db, words or []),
        "_st": st,  # internal: for DTW; stripped by the API layer
    }
