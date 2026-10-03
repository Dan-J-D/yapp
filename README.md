# Yapp

A self-hosted trainer for a more expressive voice and longer, smoother conversation ("yapping").
It records your practice and transcribes it with Whisper. It then measures **how** you speak
(pitch variation in semitones, loudness, pace, pauses) and **what** you say (fillers, topics,
pivots) using Praat and a local LLM, and tracks your trends over time.

- **Web app / PWA:** Astro + Svelte 5, installable on your phone.
- **Live feedback in the browser:** a pitch-variation meter (rolling 10 s semitone SD scaled to
  your own baseline, after Hincks & Edlund 2009), a live pitch trace, a dead-air clock and a
  subtle filler cue.
- **Accurate analysis on the server:** `voice-lab` runs faster-whisper `large-v3-turbo` and Praat
  (parselmouth) on your GPU.
- **Local LLM:** Ollama `qwen3:8b` does topic segmentation, pivot detection, curveball pickup,
  coaching tips, and plays the role-play partner.
- **HTTPS without a reverse proxy:** the app makes its own local CA. The plain-HTTP page offers
  that CA for download, with install steps for each OS.

The training design and the research behind it are in [`docs/plan.md`](docs/plan.md).

## Quick start

```sh
cp .env.example .env
npm --prefix web ci && npm --prefix web run hash-password   # paste the APP_PASSWORD_HASH line into .env
mkdir -p data                                                 # create as your user, not root
docker compose up -d --build
```

1. Open **`http://<this-machine's-LAN-IP>:8080`** on your phone. A popup offers the Yapp
   certificate, with steps for your OS. Install it once per device.
2. Tap **Continue to HTTPS**, which opens `https://<lan-ip>:8443`, and log in.
3. Run **Calibrate** first: 60 s of free talk plus a short reading. This sets your pitch
   floor and ceiling, your personal meter bands, and the expressiveness reference (100 = you
   today).
4. Install the app: browser menu › *Add to Home screen* / *Install app*.

Requirements:
- The **native Docker Engine**, not Docker Desktop. On Linux, Docker Desktop runs containers in a
  VM, so it has no NVIDIA GPU support and its host networking can't bind host interfaces such as
  `wg0`. Switch with `docker context use default`; `docker context ls` shows the current context.
- Docker with the NVIDIA container toolkit (`gpus: all`).
- Ollama running on the host with the model pulled: `ollama pull qwen3:8b`.
- No GPU available, e.g. in CI or a sandbox? Run on CPU with Whisper `small`:
  `docker compose -f docker-compose.yml -f docker-compose.cpu.yml up -d --build`.

## What's inside

| Area | Where |
|---|---|
| Daily session (warm-up → contrastive stress → model & match → free speech with meter → review) | `/daily` |
| Tonality drills, 10-step progression (advance at ≥80% of the last 15 reps), feedback fading continuous → summary → none | `/drills` |
| Yap stamina L1 Flow · L2 Retell + Pivot · L3 Plan & Drift · L4 Chaos (3 passes unlock the next) and extra modes | `/yap` |
| Weekly no-feedback transfer test | `/transfer` |
| Real-life log, daily micro-challenge (web push), LLM role-play partner | `/everyday` |
| Trends, streaks, drill voice vs everyday voice | `/`, `/history`, `/session/:id` |
| Certificate install, notifications, export/delete | `/settings` |

### Metrics

**Per recording**
- **Pitch:** F0 SD in semitones, globally and per 10 s window; p5–p95 range; phrase slope;
  final slope; per-word peak rise.
- **Loudness and voice quality:** dB SD, voicing breaks.
- **Fluency:**
  - WPM and articulation rate
  - mean length of run between pauses of 250 ms or more
  - pauses, and the % of them at clause boundaries
  - long pauses and dead air
  - fillers per minute and per 100 words
- **Vocabulary:** TTR and MATTR.
- **LLM:** topics, pivots and tips.

**Per session:** a composite expressiveness score calibrated to your baseline. After your first
week, the baseline is recomputed from that week's sessions.

## Layout

```
docker-compose.yml   web (host network, HTTPS 8443 + HTTP 8080) + voice-lab (GPU, 127.0.0.1:8765)
web/                 Astro app — src/lib (scoring, dtw, progression, audio, queue), src/lib/server
                     (job queue, voice-lab + Ollama clients, finalize, push), src/pages, src/components
web/scripts/certs.mjs   local root CA (once) + leaf cert (every start, SANs from HOSTNAMES/LAN_IPS)
web/server/          start.mjs (boot), http.mjs (cert landing page + CA download)
voice-lab/           FastAPI: faster-whisper + parselmouth prosody, DTW (see docs/voice-lab-api.md)
scripts/backup.sh    SQLite snapshot + audio + certs → backups/yapp-<date>.tar.gz
data/                SQLite DB, audio, certs, Whisper models (volume)
```

## Development

```sh
cd web && npm ci
npm test                     # Vitest: scoring, fillers, DTW, progression & level rules
npx astro check && npm run build
npm start                    # boots certs + HTTP landing + HTTPS app (needs a build)

cd voice-lab && uv venv .venv && uv pip install --python .venv/bin/python -r requirements.txt
.venv/bin/pytest -q          # synthetic sweeps, stress peaks, pauses, DTW, API
WHISPER_MODEL=base .venv/bin/uvicorn app:app --port 8765
```

When `web` runs outside Docker, set `VOICE_LAB_DATA_DIR` to the same absolute path as `DATA_DIR`,
so voice-lab can find the audio files.

## Network binding

The web container uses host networking. `BIND_HOST` in `.env` is a comma-separated list of addresses
the HTTP (8080) and HTTPS (8443) servers listen on. For example, `BIND_HOST=10.0.0.1,127.0.0.1`
serves on WireGuard and localhost only.
- Set `LAN_IPS` to the same addresses so the certificate matches them (127.0.0.1 and `localhost` are always included).
- voice-lab only listens on `127.0.0.1:8765`. Ollama is reached on `127.0.0.1:11434`.
- If the interface isn't up yet, the server can't bind. Docker keeps restarting the container
  until it can.

## Certificates

- **Root CA:** `data/certs/ca.crt`, valid for 10 years. It is created once and kept, so each
  device installs it only once.
- **Leaf certificate:** re-issued on every start. It is ECDSA P-256, valid for 397 days, with
  `serverAuth` EKU, and its SANs cover `localhost`, the hostname, `HOSTNAMES` and every LAN IP.
- **Inspect the leaf:** `openssl x509 -in data/certs/leaf.crt -noout -text`.
- **Fingerprint:** shown on the HTTP landing page and in Settings › Devices. It stays the same
  across restarts.
- **Android:** Chrome may install the PWA as a plain home-screen shortcut, not a WebAPK, on a
  private LAN. The app still works offline either way.

## Backups

`scripts/backup.sh [dest]` writes a consistent SQLite snapshot, the audio and the certs (keep the
root CA!) into a tarball and keeps the last 14. Settings › Data can also export everything as
JSON or delete all practice data.
