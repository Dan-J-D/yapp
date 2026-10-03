import numpy as np
import pytest

import prosody
from conftest import log_sweep, silence, to_sound, tone, with_noise


def analyze(x, floor=75, ceiling=500, words=None):
    tr = prosody.compute_tracks(to_sound(with_noise(x)), floor, ceiling)
    return tr, prosody.analyze_tracks(tr, words)


# (a) known semitone range --------------------------------------------------------------

def test_sweep_known_range():
    # 110 -> 220 Hz log sweep over 3 s: ST uniformly spread over 12 ST.
    x = tone(log_sweep(110, 220, 3.0))
    tr, res = analyze(x)
    p = res["pitch"]
    st = prosody.st_track(tr.f0_hz)[0]
    v = st[~np.isnan(st)]
    assert np.mean(~np.isnan(tr.f0_hz)) > 0.9
    assert v.max() - v.min() == pytest.approx(12.0, abs=1.0)
    # uniform distribution over 12 ST: p5..p95 = 10.8 ST, SD = 12/sqrt(12) = 3.46 ST
    assert p["range_st"] == pytest.approx(10.8, abs=0.8)
    assert p["st_sd"] == pytest.approx(3.46, abs=0.3)
    assert p["median_hz"] == pytest.approx(155.6, rel=0.05)
    assert p["glide_breaks"] == 0


# (b) flat pitch --------------------------------------------------------------------------

def test_flat_tone_has_no_variation():
    _, res = analyze(tone(150, 2.0))
    p = res["pitch"]
    assert p["median_hz"] == pytest.approx(150, rel=0.01)
    assert p["st_sd"] < 0.1
    assert p["range_st"] < 0.2
    assert abs(p["final_slope_st_per_s"]) < 0.5
    assert res["pauses"] == []


# (c) stress peak -------------------------------------------------------------------------

def test_stress_peak_on_middle_word():
    gap = silence(0.1)
    w1 = tone(140, 0.3, amp=0.2)
    w2 = tone(140 * 2 ** (4 / 12), 0.3, amp=0.5)  # +4 ST and louder
    w3 = tone(140, 0.3, amp=0.2)
    x = np.concatenate([silence(0.2), w1, gap, w2, gap, w3, silence(0.2)])
    words = [
        {"w": "the", "start": 0.2, "end": 0.5},
        {"w": "BIG", "start": 0.6, "end": 0.9},
        {"w": "dog", "start": 1.0, "end": 1.3},
    ]
    tr = prosody.compute_tracks(to_sound(with_noise(x)), 75, 500)
    st, _ = prosody.st_track(tr.f0_hz)
    out = prosody.word_prosody(tr.t, st, tr.db, words)
    a, b, c = out
    assert b["f0_peak_st"] - a["f0_peak_st"] >= 3.0
    assert b["f0_peak_st"] - c["f0_peak_st"] >= 3.0
    assert b["db_mean"] > a["db_mean"] + 3
    assert b["db_peak"] > c["db_peak"] + 3
    assert all(w["voiced_frac"] > 0.6 for w in out)
    assert b["w"] == "BIG"  # original keys preserved


# (d) pauses ------------------------------------------------------------------------------

def test_single_pause_detected():
    x = np.concatenate([silence(0.3), tone(150, 1.0), silence(0.6), tone(150, 1.0), silence(0.3)])
    _, res = analyze(x)
    pauses = res["pauses"]
    assert len(pauses) == 1
    dur = pauses[0]["end"] - pauses[0]["start"]
    assert dur == pytest.approx(0.6, abs=0.1)
    assert pauses[0]["start"] == pytest.approx(1.3, abs=0.1)
    assert len(res["pitch"]["phrases"]) == 2


def test_short_gap_is_not_a_pause():
    x = np.concatenate([tone(150, 1.0), silence(0.15), tone(150, 1.0)])
    _, res = analyze(x)
    assert res["pauses"] == []
    assert len(res["pitch"]["phrases"]) == 1
    assert res["pitch"]["voicing_breaks"] == 1


def test_detect_pauses_unit():
    t = np.arange(100) * 0.01
    voiced = np.ones(100, bool)
    voiced[40:70] = False
    db = np.full(100, 70.0)
    db[40:70] = 20.0
    pauses = prosody.detect_pauses(t, voiced, db)
    assert len(pauses) == 1
    assert pauses[0][1] - pauses[0][0] == pytest.approx(0.30, abs=1e-6)
    # loud unvoiced stretch (e.g. a fricative) is not silence
    db[40:70] = 68.0
    assert prosody.detect_pauses(t, voiced, db) == []


# (e) DTW ---------------------------------------------------------------------------------

def _shape(n=200):
    tt = np.linspace(0, 1, n)
    return 4 * np.sin(2 * np.pi * tt) + 2 * tt  # rise-fall-rise contour in ST


def test_dtw_identical_is_one():
    c = _shape()
    assert prosody.dtw_similarity(c, c) == pytest.approx(1.0, abs=1e-9)


def test_dtw_inverted_is_low():
    c = _shape()
    assert prosody.dtw_similarity(c, -c) < 0.3


def test_dtw_time_stretched_is_high():
    c = _shape(200)
    stretched = prosody.resample_linear(c, 320)
    # non-uniform warp too
    warped = np.interp(np.linspace(0, 1, 250) ** 1.3, np.linspace(0, 1, 200), c)
    assert prosody.dtw_similarity(c, stretched) > 0.95
    assert prosody.dtw_similarity(c, warped) > 0.8


def test_dtw_ignores_offset_scale_and_nans():
    c = _shape()
    other = 0.5 * c + 3.0
    other[50:60] = np.nan
    assert prosody.dtw_similarity(c, other) > 0.9


def test_range_ratio_and_peak_timing():
    tt = np.linspace(0, 1, 101)
    ref = 6 * np.exp(-((tt - 0.3) ** 2) / 0.01)
    user = 3 * np.exp(-((tt - 0.5) ** 2) / 0.01)
    cmp = prosody.compare_contours(user, ref)
    assert cmp["range_ratio"] == pytest.approx(0.5, abs=0.02)
    assert cmp["peak_timing_diff"] == pytest.approx(0.2, abs=0.02)
    assert 0 <= cmp["similarity"] <= 1


def test_dtw_band_respected():
    a = np.array([0.0, 1, 0, 0, 0, 0])
    b = np.array([0.0, 0, 0, 0, 1, 0])
    assert prosody.dtw_distance(a, b, band=0) == pytest.approx(2 / 6)
    assert prosody.dtw_distance(a, b, band=3) == 0.0


# (f) final slope -------------------------------------------------------------------------

def test_final_slope_rising_vs_falling():
    flat = tone(150, 0.8)
    rise = tone(log_sweep(150, 220, 0.6))
    fall = tone(log_sweep(150, 100, 0.6))
    _, r = analyze(np.concatenate([flat[:-160], rise, silence(0.2)]))
    _, f = analyze(np.concatenate([flat[:-160], fall, silence(0.2)]))
    assert r["pitch"]["final_slope_st_per_s"] > 5
    assert f["pitch"]["final_slope_st_per_s"] < -5


# misc ------------------------------------------------------------------------------------

def test_glide_break_counted():
    x = np.concatenate([tone(120, 0.5)[:-80], tone(200, 0.5)[80:]])  # abrupt ~9 ST jump
    _, res = analyze(x)
    assert res["pitch"]["glide_breaks"] >= 1


def test_contour_windows_shapes():
    x = np.concatenate([tone(log_sweep(120, 180, 6.0)), silence(1.0), tone(150, 6.0)])
    _, res = analyze(x)
    c = res["contour"]
    assert c[0][0] == 0.0
    assert c[1][0] == pytest.approx(0.02)
    assert len(c) == pytest.approx(13.0 / 0.02 + 1, abs=2)
    assert any(v is None for _, v in c) and any(v is not None for _, v in c)
    w = res["windows"]
    assert [x["start"] for x in w] == [0.0, 10.0]
    assert w[1]["end"] == pytest.approx(13.0, abs=0.01)
    assert w[0]["st_sd"] > w[1]["st_sd"]
    assert 0 < w[0]["voiced_frac"] <= 1


def test_silence_only_is_safe():
    _, res = analyze(silence(1.0))
    assert res["pitch"]["st_sd"] is None
    assert res["pauses"] == []
    assert res["pitch"]["phrases"] == []


def test_load_audio_non_wav_via_ffmpeg(tmp_path):
    import subprocess

    from conftest import write_wav

    src = write_wav(tmp_path / "a.wav", tone(200, 1.0))
    ogg = tmp_path / "a.ogg"
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", src, "-ar", "48000", "-ac", "2", str(ogg)],
                   check=True)
    snd = prosody.load_audio(str(ogg))
    assert snd.sampling_frequency == 16000
    assert snd.n_channels == 1
    assert snd.duration == pytest.approx(1.0, abs=0.05)
    with pytest.raises(FileNotFoundError):
        prosody.load_audio(str(tmp_path / "missing.webm"))
