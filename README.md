# 🗣️ Yapp

**Train to yap. Professionally.**

Some people can talk for an hour about a sandwich. Others run out after "yeah, it was good" and
say it in one flat note. Yapp is a self-hosted gym for the second group:

- 🏃 **Stamina:** keep talking without stalling, "um"-ing, or accidentally ending the conversation.
- 🎵 **Tonality:** trade the hold-music voice for some actual melody.

Talk into your phone. Yapp transcribes you, measures **how** you sound (pitch, pace, pauses) and
**what** you say (fillers, topics), and turns it into a daily ~18-minute workout that levels up
with you. It runs entirely on your machine 🔒, so nobody else hears you practise.

🔬 The drills come from speech research, not "just be confident" advice: a live pitch-variation
meter (Hincks & Edlund 2009), contrastive stress, model-and-match contours, and shrinking retells
(Nation 1989).

<p align="center">
  <img src="docs/imgs/desktop-home.jpg" alt="Yapp home on desktop: today's yap, streak, progress" width="68%">
  &nbsp;
  <img src="docs/imgs/mobile-home.jpg" alt="Yapp home on iPhone" width="22%">
</p>

<details>
<summary>📸 <b>More screenshots</b> (desktop + iPhone)</summary>
<br>

| Page | Desktop | iPhone |
|---|---|---|
| **Daily**: the ~18-min base, each step with its *why* | <img src="docs/imgs/desktop-daily.jpg" alt="Daily session, desktop" width="420"> | <img src="docs/imgs/mobile-daily.jpg" alt="Daily session, iPhone" width="160"> |
| **Yap**: Y1 Story retell → Y4 Chaos | <img src="docs/imgs/desktop-yap.jpg" alt="Yap levels, desktop" width="420"> | <img src="docs/imgs/mobile-yap.jpg" alt="Yap levels, iPhone" width="160"> |
| **Drills**: 10-step tonality progression | <img src="docs/imgs/desktop-drills.jpg" alt="Tonality drills, desktop" width="420"> | <img src="docs/imgs/mobile-drills.jpg" alt="Tonality drills, iPhone" width="160"> |
| **Everyday**: micro-challenge, real-life log, role-play | <img src="docs/imgs/desktop-everyday.jpg" alt="Everyday transfer, desktop" width="420"> | <img src="docs/imgs/mobile-everyday.jpg" alt="Everyday transfer, iPhone" width="160"> |
| **History**: every session with pitch, pace and fillers | <img src="docs/imgs/desktop-history.jpg" alt="History, desktop" width="420"> | <img src="docs/imgs/mobile-history.jpg" alt="History, iPhone" width="160"> |
| **Settings**: filler cue, partner voice, retell timing | <img src="docs/imgs/desktop-settings.jpg" alt="Settings, desktop" width="420"> | <img src="docs/imgs/mobile-settings.jpg" alt="Settings, iPhone" width="160"> |

</details>

## ✨ Features

- 📅 **One daily session:** warm-up → contrastive stress → model & match → yap → review. Optional
  extras show whether they're available, due, done or locked (and why).
- 📈 **Live feedback while you talk:** pitch-variation meter scaled to your baseline, pitch
  trace, dead-air clock, and a subtle filler cue that fades out as you improve.
- 🎚️ **Tonality drills:** 10 steps. Hit 80% of your last 15 reps to advance; feedback fades from
  continuous to none.
- 💬 **Yap levels:** **Y1** story retell → **Y2** explain retell → **Y3** conversation with an AI
  that asks follow-ups and changes topic → **Y4** chaos. Three passing days unlock the next
  level, and stories come back tomorrow and next week so they stick.
- 🌍 **Real-life transfer:** weekly no-feedback test, real-conversation log, a daily
  micro-challenge by push notification, and an AI role-play partner.
- 📊 **Progress:** trends, streaks, practice voice vs everyday voice, and per-session transcripts
  with coaching tips.
- 📱 **Installable PWA** with built-in HTTPS (its own local CA, no domain or proxy needed).
- 💾 **Your data, your call:** JSON export, delete-all, one-command backups.

<details>
<summary>📐 <b>What it measures</b></summary>
<br>

- **Pitch:** semitone SD (overall and per 10 s), p5–p95 range, phrase and final slope, per-word
  peak rise.
- **Loudness and voice:** dB SD, voicing breaks.
- **Fluency:** WPM, articulation rate, mean length of run, pause count and % at clause
  boundaries, dead air, fillers per minute and per 100 words.
- **Vocabulary:** TTR, MATTR.
- **Content (LLM):** topics, pivots, tips.
- **Per session:** an expressiveness score where 100 = your calibrated baseline, recomputed after
  week one.

</details>

## 🚀 Quick start

You need:
- 🐧 Linux with the **native Docker Engine** (Docker Desktop has no NVIDIA GPU or real host
  networking on Linux) and the NVIDIA container toolkit.
- 🦙 [Ollama](https://ollama.com) on the host: `ollama pull qwen3:8b`.

```sh
cp .env.example .env
npm --prefix web ci && npm --prefix web run hash-password   # paste the APP_PASSWORD_HASH line into .env
mkdir -p data                                                 # create as your user, not root
docker compose up -d --build
```

1. 📲 Open `http://<lan-ip>:8080` on your phone and install the Yapp certificate (once per device).
2. 🔐 Tap **Continue to HTTPS** and log in.
3. 🎙️ Run **Calibrate**: 60 s of free talk plus a short reading sets your personal baseline.
4. 🏠 Add it to your home screen.

No GPU? Run on CPU with a smaller Whisper model:

```sh
docker compose -f docker-compose.yml -f docker-compose.cpu.yml up -d --build
```

## ⚙️ Configuration

Everything lives in `.env` (see [`.env.example`](.env.example)).

| Variable | Default | Purpose |
|---|---|---|
| `APP_PASSWORD_HASH` | — | Argon2 hash of your login password |
| `BIND_HOST` | `0.0.0.0` | Addresses to listen on, comma-separated (e.g. a VPN interface + `127.0.0.1`) |
| `LAN_IPS` / `HOSTNAMES` | auto | Extra certificate names; set `LAN_IPS` to match `BIND_HOST` |
| `HTTPS_PORT` / `HTTP_PORT` | `8443` / `8080` | App / certificate landing page |
| `WHISPER_MODEL` | `large-v3-turbo` | Transcription model |
| `OLLAMA_URL` / `OLLAMA_MODEL` | `http://127.0.0.1:11434` / `qwen3:8b` | LLM |
| `TZ` | `UTC` | When your "day" starts for streaks and level passes |

<details>
<summary>🌐 <b>Networking and certificates</b></summary>
<br>

- `web` uses host networking, so `BIND_HOST` can lock it to specific interfaces. If an interface
  isn't up yet, Docker keeps restarting the container until it can bind.
- voice-lab listens only on `127.0.0.1:8765`; Ollama is reached on `127.0.0.1:11434`.
- The root CA (`data/certs/ca.crt`, 10 years) is created once, so each device installs it once.
- The leaf certificate is re-issued on every start and covers `localhost`, the hostname,
  `HOSTNAMES` and every LAN IP. Its fingerprint is shown on the landing page and in Settings.
- On Android, Chrome may install the PWA as a plain shortcut on a private LAN. It still works
  offline.

</details>

## 🛠️ Development

```sh
cd web && npm ci
npm test                          # Vitest
npx astro check && npm run build
npm start                         # certs + HTTP landing + HTTPS app (needs a build)

cd voice-lab && uv venv .venv && uv pip install --python .venv/bin/python -r requirements.txt
.venv/bin/pytest -q               # no GPU or model download needed
WHISPER_MODEL=base .venv/bin/uvicorn app:app --port 8765
```

Running `web` outside Docker? Set `VOICE_LAB_DATA_DIR` to the same absolute path as `DATA_DIR`.

<details>
<summary>🗂️ <b>Project layout</b></summary>
<br>

```
web/src/lib             scoring, DTW, progression, daily program, audio capture
web/src/lib/server      job queue, voice-lab + Ollama clients, push
web/server/             boot script + certificate landing page
web/scripts/certs.mjs   local root CA + leaf certificate
voice-lab/              FastAPI: faster-whisper + Praat prosody (docs/voice-lab-api.md)
scripts/backup.sh       SQLite + audio + certs → backups/yapp-<date>.tar.gz
data/                   database, audio, certs, models (gitignored)
```

</details>

## 💾 Backups

`scripts/backup.sh [dest]` snapshots the database, audio and certs into a tarball and keeps the
last 14. Keep the root CA, or every device has to reinstall it.

## ⚠️ Disclaimer

Yapp is a practice tool, not a medical device. For a voice or speech disorder, see a
speech-language pathologist.
