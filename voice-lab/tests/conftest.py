import os
import sys
import wave

import numpy as np
import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

SR = 16000


def tone(f0, dur=None, sr=SR, amp=0.3, harmonics=12):
    """Harmonic-rich (sawtooth-like) tone. f0: scalar Hz or per-sample array."""
    if np.isscalar(f0):
        f0 = np.full(int(round(dur * sr)), float(f0))
    f0 = np.asarray(f0, dtype=float)
    phase = 2 * np.pi * np.cumsum(f0) / sr
    sig = np.zeros_like(phase)
    for k in range(1, harmonics + 1):
        sig += np.sin(k * phase) / k
    sig /= np.max(np.abs(sig))
    # 10 ms raised-cosine fades to avoid clicks
    n = min(int(0.01 * sr), sig.size // 2)
    if n:
        ramp = 0.5 - 0.5 * np.cos(np.linspace(0, np.pi, n))
        sig[:n] *= ramp
        sig[-n:] *= ramp[::-1]
    return amp * sig


def log_sweep(f_start, f_end, dur, sr=SR):
    n = int(round(dur * sr))
    return f_start * (f_end / f_start) ** (np.arange(n) / max(n - 1, 1))


def silence(dur, sr=SR):
    return np.zeros(int(round(dur * sr)))


def with_noise(x, level=1e-4, seed=0):
    return x + np.random.default_rng(seed).normal(0, level, x.size)


def write_wav(path, x, sr=SR):
    pcm = (np.clip(x, -1, 1) * 32767).astype(np.int16)
    with wave.open(str(path), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(sr)
        w.writeframes(pcm.tobytes())
    return str(path)


def to_sound(x, sr=SR):
    import parselmouth

    return parselmouth.Sound(np.asarray(x, dtype=float), sampling_frequency=sr)


@pytest.fixture
def make_sound():
    return to_sound
