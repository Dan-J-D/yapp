import numpy as np
import pytest
from fastapi.testclient import TestClient

import app as app_module
from conftest import log_sweep, silence, tone, with_noise, write_wav


class FakeTranscriber:
    model_name = "fake-model"
    device = "cpu"
    loaded = True

    def __init__(self):
        self.calls = []

    def transcribe(self, audio, language, initial_prompt):
        self.calls.append({"n": len(audio), "dtype": audio.dtype, "language": language,
                           "initial_prompt": initial_prompt})
        return {
            "language": language or "en",
            "text": "Um, hello there.",
            "segments": [{"start": 0.2, "end": 1.7, "text": "Um, hello there."}],
            "words": [
                {"w": "Um,", "start": 0.2, "end": 0.6, "prob": 0.9},
                {"w": "hello", "start": 0.9, "end": 1.3, "prob": 0.99},
                {"w": "there.", "start": 1.3, "end": 1.7, "prob": 0.97},
            ],
        }


@pytest.fixture
def fake(monkeypatch):
    f = FakeTranscriber()
    monkeypatch.setattr(app_module, "transcriber", f)
    return f


@pytest.fixture
def client():
    return TestClient(app_module.app)


@pytest.fixture
def clip(tmp_path):
    x = np.concatenate([silence(0.2), tone(140, 0.4), silence(0.3),
                        tone(log_sweep(140, 200, 0.8)), silence(0.2)])
    return write_wav(tmp_path / "clip.wav", with_noise(x))


def test_health(client, fake):
    r = client.get("/health")
    assert r.status_code == 200
    assert r.json() == {"ok": True, "whisper_loaded": True, "device": "cpu", "model": "fake-model"}


def test_health_real_transcriber_is_lazy(client):
    r = client.get("/health").json()
    assert r["ok"] is True
    assert r["whisper_loaded"] is False
    assert r["device"] in ("cpu", "cuda")
    assert r["model"]


def test_analyze_full(client, fake, clip):
    r = client.post("/analyze", json={"path": clip, "language": "en", "f0_floor": 75,
                                      "f0_ceiling": 500})
    assert r.status_code == 200, r.text
    d = r.json()
    for key in ("duration_s", "language", "text", "segments", "words", "pitch", "intensity",
                "contour", "windows", "pauses"):
        assert key in d
    assert "dtw" not in d
    assert d["duration_s"] == pytest.approx(1.9, abs=0.01)
    assert d["text"] == "Um, hello there."
    assert fake.calls[0]["initial_prompt"] == app_module.DEFAULT_PROMPT
    assert fake.calls[0]["dtype"] == np.float32
    assert fake.calls[0]["n"] == pytest.approx(1.9 * 16000, abs=2)

    w = d["words"]
    assert [x["w"] for x in w] == ["Um,", "hello", "there."]
    for x in w:
        assert set(x) >= {"w", "start", "end", "prob", "f0_peak_st", "f0_mean_st", "db_mean",
                          "db_peak", "voiced_frac"}
    assert w[2]["f0_peak_st"] > w[0]["f0_peak_st"]  # the sweep word rises

    p = d["pitch"]
    for key in ("median_hz", "st_sd", "p5_st", "p95_st", "range_st", "mean_abs_phrase_slope",
                "phrases", "final_slope_st_per_s", "voicing_breaks", "glide_breaks"):
        assert key in p
    assert p["final_slope_st_per_s"] > 0
    assert len(d["pauses"]) == 1
    assert d["pauses"][0]["end"] - d["pauses"][0]["start"] == pytest.approx(0.3, abs=0.08)
    assert set(d["intensity"]) == {"db_mean", "db_sd"}
    assert d["contour"][0] == [0.0, None]
    assert d["windows"][0]["start"] == 0


def test_analyze_prosody_only_with_reference(client, fake, clip, tmp_path):
    ref = write_wav(tmp_path / "ref.wav",
                    with_noise(np.concatenate([tone(150, 0.3), tone(log_sweep(150, 230, 1.2))]),
                               seed=1))
    r = client.post("/analyze", json={"path": clip, "transcribe": False,
                                      "reference_path": ref, "initial_prompt": "x"})
    assert r.status_code == 200, r.text
    d = r.json()
    assert fake.calls == []
    assert d["text"] == "" and d["words"] == [] and d["segments"] == []
    assert d["language"] == "en"
    assert set(d["dtw"]) == {"similarity", "range_ratio", "peak_timing_diff"}
    assert 0 <= d["dtw"]["similarity"] <= 1


def test_analyze_stereo_44k_wav_and_custom_prompt(client, fake, tmp_path):
    import wave

    x = (tone(180, 1.0, sr=44100) * 32767).astype(np.int16)
    path = tmp_path / "st.wav"
    with wave.open(str(path), "wb") as wf:
        wf.setnchannels(2)
        wf.setsampwidth(2)
        wf.setframerate(44100)
        wf.writeframes(np.repeat(x, 2).tobytes())
    r = client.post("/analyze", json={"path": str(path), "initial_prompt": "Uh, um."})
    assert r.status_code == 200, r.text
    assert r.json()["pitch"]["median_hz"] == pytest.approx(180, rel=0.02)
    assert fake.calls[0]["initial_prompt"] == "Uh, um."
    assert fake.calls[0]["n"] == pytest.approx(16000, abs=2)


def test_errors(client, fake, tmp_path):
    r = client.post("/analyze", json={"path": str(tmp_path / "nope.webm")})
    assert r.status_code == 404
    assert "detail" in r.json()

    bad = tmp_path / "bad.webm"
    bad.write_bytes(b"not audio at all")
    r = client.post("/analyze", json={"path": str(bad)})
    assert r.status_code == 422
    assert "detail" in r.json()

    r = client.post("/analyze", json={"path": str(bad), "f0_floor": 300, "f0_ceiling": 200})
    assert r.status_code == 422

    r = client.post("/analyze", json={})
    assert r.status_code == 422
