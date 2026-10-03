# Yapp — Voice Tonality & Yapping Stamina Trainer

## Context
You want a personal app for three things: fixing a monotone voice, carrying more tonal variety into everyday talking, and building conversational stamina ("yapping"). It is a self-hosted Astro + Svelte web app that can be installed as a PWA. It records sessions, transcribes them with Whisper, and analyzes both **how** you speak (pitch, loudness, pace, pauses) and **what** you say (fillers, topics, pivots) using a local LLM. It keeps history and trends.

Decisions so far:
- Self-hosted with Docker on this machine (NVIDIA GPU, 62 GB RAM, Ollama 0.17.5 already on the host).
- Single user, with recordings and historical stats.
- Web app with PWA support only.
- Local LLM through Ollama.
- No reverse proxy. The app serves HTTPS itself with a self-signed local CA, and offers that CA for download from a popup on the plain-HTTP page.
- `/home/d/Source/yapp` is empty and not yet a git repo.

The training content was researched for evidence instead of taken from the original roadmap (sources are listed inline). Several popular methods don't hold up, and the plan reflects that.

---

## 1. Research findings that shape the design

**Monotone / intonation**
- **Best evidence for real-world transfer: a live pitch-variation meter while speaking freely.** Hincks & Edlund (2009, [LLT 13(3)](https://www.lltjournal.org/item-detail/530/)) is a small RCT.
  - Setup: rolling 10 s F0 standard deviation in semitones (ST), scaled to the speaker's own baseline, about 100 ms latency, *no* contour display.
  - Dose: about 3 h total in 30-min sessions over 4 weeks.
  - Gains carried over to a later presentation given without feedback, and raters did not judge the speech as unnatural.
- **Model-and-match with visual contour overlay** improves prosody and generalizes to new sentences ([Hardison 2004](https://doaj.org/article/581055d4d4ec401da83bbc04117ec8c9), [Frontiers 2021](https://pmc.ncbi.nlm.nih.gov/articles/PMC8297736)). Score the *shape* (range, where the peak falls), not an exact copy.
- **Contrastive stress / operative words.** Listeners pick out the focus word with over 93% accuracy, flattened contours reduce intelligibility, and monotone delivery reduces listener recall ([Patel & Campellone 2009](https://pubs.asha.org/doi/10.1044/1092-4388(2008/07-0078)), [Bunton 2001](https://sites.arizona.edu/sapl/files/2023/10/Bunton-et-al-2001.pdf)).
- **Fading-cue prosody hierarchy (imitative and cognitive-linguistic tracks)** for emotional range: Rosenbek et al. 2004, JINS.
- **LSVT** is the template for *dose and structure*: high effort, at least 15 reps per task, one simple cue, words → phrases → conversation. Its RCT raised semitone SD in monologue, maintained at 2 years ([Ramig 2001](https://jnnp.bmj.com/content/71/4/493)).
- **Conversation Training Therapy** adds two things:
  - *Negative practice*: alternate your old flat voice with the new one so you can feel the difference.
  - Train conversation early instead of only at the end of the progression.
- **SOVT (straw phonation, lip trills), resonant voice and Stemple VFE improve vocal *efficiency and ease*, not expressiveness.** They are used only as a 2–3 min warm-up (optional "voice fitness" module).
- **Weak or folk advice, deliberately excluded or kept minimal:**
  - Linklater, Rodenburg, Roger Love, Lessac "Tonal NRG", Estill: no acoustic transfer studies found.
  - "Pitch, pace, power, pause" is a mnemonic, not a method.
  - "Breathe from the diaphragm" and "smile to sound warm" are folk advice.
  - Melodic Intonation Therapy is for aphasia and isn't relevant here.
- **Thresholds.** There is no validated cutoff for "monotone." Reference group means for semitone SD ([Rusz 2011](https://sami.fel.cvut.cz/Articles/Rusz_et_al_FA2011.pdf)):

  | Task | Healthy | Early Parkinson's (PD) |
  |---|---|---|
  | Reading | 2.48 | 1.71 |
  | Monologue | 2.44 | 1.53 |
  | Emotional | 3.82 | 2.59 |

  - Starting bands: <1.7 monotone, 1.7–2.2 low, 2.2–3.0 typical, >3.0 expressive. **Recalibrate these against your own pipeline and baseline.**
  - Phrase-level F0 slope correlates best with perceived monopitch (r = .70), so log it too.

**Stamina / fluency / fillers**
- **Fillers are a symptom of planning load** ([Bortfeld 2001](https://researchconnect.stonybrook.edu/en/publications/disfluency-rates-in-conversation-effects-of-age-relationship-topi/), Clark & Fox Tree 2002). The goal is fewer fillers, not zero.
- **Awareness training works and lasts.** You review your own recording and tag the fillers, with an optional competing response of a silent pause (Montes et al. 2019 JABA; Mancuso & Miltenberger 2016).
- **Real-time filler cues help**, provided they are subtle and fade out over time ([Rhema/Rochester](https://www.rochester.edu/newscenter/wearable-technology-can-help-with-public-speaking-95552)).
- **4/3/2 shrinking retell is the strongest fluency drill.** Speech rate goes up and hesitations go down across retellings (Nation 1989; Boers 2014 found shrinking time beats constant time). Task repetition and short pre-planning also help.
- **Pause *location* matters more than pause count** ([Cambridge SSLA](https://www.cambridge.org/core/product/D8EF194FCD2C5FBF0D6BA49EF6F0624E)). Clause-boundary pauses sound fluent; mid-clause pauses sound disfluent.
  - **The original "No Silence" rule backfires** because it pushes you to fill gaps with "um". It is changed to: *silent pauses are fine, no dead air over 3 s, no filler-filled gaps*.
- **Improv, Table Topics, PREP and Story Spine** have weaker evidence. They are kept as variety and confidence modes, not core drills.

---

## 2. Training program

### Daily session (~15–20 min, 5 days a week; LSVT/Hincks-style dose)
| Min | Block | Scoring |
|---|---|---|
| 2 | **Warm-up**: straw/lip-trill glides + range sirens | usable range in ST (p5–p95), glide smoothness (breaks >1.5 ST/frame), weekly range trend |
| 4 | **Contrastive stress**: 3 sentences × 4 stress positions, ≥15 reps total | target-word F0 peak ≥2–4 ST above neighbors, dB gain, duration ratio, whether the peak landed on the correct word (Whisper word timestamps) |
| 4 | **Model & match**: 5 phrases (model library + your own best takes), 3–5 reps each, contour overlay | DTW shape similarity on ST-normalized F0, range ratio, peak timing |
| 4–6 | **Free speech with live variation meter** (Hincks): prompt, 60–90 s answers | % of time in the green band, rolling 10 s ST SD vs baseline, phrase slope |
| 1 | **Review**: playback, fillers highlighted (awareness tagging), metrics vs baseline | filler confirmations, deltas |

**Weekly transfer test:** a 2-minute monologue with **no feedback**. It is the honest measure of carryover and your built-in A/B check.

### Tonality progression (advance at ≥80% of reps on target)
1. Sustained sounds and glides
2. Single words with a pitch rise
3. Contrastive stress in fixed sentences
4. Imitated phrases
5. Reading with marked operative words
6. Unmarked reading
7. Scripted Q&A
8. Free monologue
9. Simulated conversation (LLM role-play partner voiced by browser TTS)
10. Real-life clips

- **Feedback fades** as you advance: continuous → summary only → none.
- **Conversation-level tasks appear from week 1** in short doses (Conversation Training Therapy), not only at the end.

**Extra drill modes**
- **Emotion range** (Rosenbek fading cues): the same sentence in your neutral voice, then excited, bored, suspicious, warm and urgent, compared against the neutral take.
- **Negative practice**: flat take vs lively take on the same line.
- **Statement vs question endings**: slope of the final 400 ms.

### Yap stamina levels (revised from your roadmap)
| Level | Format | Pass criteria (3 passing sessions unlocks the next) |
|---|---|---|
| L1 Flow | 2 min, one familiar topic, silent pauses allowed | no dead air >3 s, fillers below your baseline −X% |
| L2 Retell + Pivot | 2 min talk → **1.5 min retell** (shrinking) → 1 bridged pivot | retell WPM ≥ first telling, pivot gap <1.5 s with no filler |
| L3 Plan & Drift | 30 s PREP plan → 5 min with ≥3 pivots → 90 s compressed summary | ≥3 pivots detected by the LLM, mean length of run ≥ baseline |
| L4 Chaos | 10+ min, curveball words every 60–90 s (on screen + spoken by TTS) | recovery latency (curveball → first content word) <3 s, few fillers in the 10 s after |

- **Tonality overlay:** every yap session shows the live variation meter. It turns amber or red when your rolling 10 s ST SD falls into your monotone band.
- **Filler cue:** an optional subtle flash or vibration when a filler is detected. It fades out as your filler rate drops.
- **Extra modes:**
  - Daily Retell: same topic 3×, repeated the next day.
  - Table Topics roulette.
  - Story Spine.
  - Expert: lecture confidently on a nonsense topic.
  - Bridge drill: random topic A → B using bridge phrases.

### Everyday transfer
- **Daily micro-challenge** via web push. Examples: narrate 2 min like a documentary, or explain your job to a 10-year-old.
- **Real-life log**: a 30–60 s recap clip after real conversations, tagged so you can compare drill voice vs everyday voice.

### Metrics stored per session (and per 10 s window)

**Pitch**
- F0 ST SD (global and rolling 10 s)
- p5–p95 range
- phrase slope
- per-word peak rise

**Loudness and voice quality**
- dB SD
- voicing breaks

**Fluency**
- speech rate (WPM)
- articulation rate (syllables/s, pauses excluded)
- mean length of run between ≥250 ms pauses
- pause count, and % of pauses at clause boundaries (Whisper punctuation as a proxy)
- long pauses (>2–3 s) per minute
- fillers per minute and per 100 words

**Content**
- pivots and topics (LLM)
- type-token ratio

**Composite:** an expressiveness score calibrated to your first-week baseline.

---

## 3. Architecture

```
Browser (Astro pages + Svelte 5 islands, PWA)
  ├─ mic → MediaRecorder (opus) + AudioWorklet: live F0 (pitchy/McLeod, per-user floor/ceiling clamp
  │        to avoid octave errors), RMS, VAD, rolling 10 s ST SD meter, contour canvas
  ├─ IndexedDB upload queue (offline record → sync later)
  └─ Astro API routes
web container: Node — Astro standalone over HTTPS (SERVER_CERT_PATH/SERVER_KEY_PATH)
             + tiny plain-HTTP server (cert landing/popup + redirect)
  ├─ SQLite (Drizzle) + /data/audio
  ├─ in-process job queue → voice-lab
  └─ Ollama on host (host.docker.internal:11434), JSON-schema structured output
voice-lab container (Python FastAPI, GPU)
  ├─ faster-whisper large-v3-turbo, word_timestamps=True
  └─ praat-parselmouth: F0 (ST rel. median), intensity, word-level prosody, DTW contour scoring
```

- **Live metrics run in the browser** for low latency. **Accurate stats run on the server** with Praat after upload, and stored stats come from the server.
- **LLM** (`qwen3:8b`-class): topic segmentation, pivot detection with timestamps, curveball pickup check, 3 coaching tips, and the L3/conversation role-play partner.
- **Auth:** single password (argon2 hash in `.env`) plus an HTTP-only session cookie, enforced in Astro middleware.

### HTTPS without a reverse proxy (local CA)
- **`web/scripts/certs.mjs`** runs at container start, using openssl:
  - **Root CA**: generated **once** and persisted in the `data/certs/` volume, so devices never need to reinstall it. It uses `basicConstraints CA:TRUE`, `keyUsage keyCertSign,cRLSign` and 10-year validity.
  - **Leaf cert**: re-issued on every start (this handles LAN IP changes). It has `CA:FALSE`, `extendedKeyUsage serverAuth`, SHA-256 with RSA-2048 or ECDSA, ≤397 days validity (Apple caps at 825), and SANs for `DNS:` from `HOSTNAMES` plus `IP:` from `LAN_IPS` (auto-detected when unset, plus localhost).
- **HTTPS:** Astro `@astrojs/node` standalone serves it natively via `SERVER_CERT_PATH` / `SERVER_KEY_PATH` ([docs](https://docs.astro.build/en/guides/integrations-guide/node/)). Standalone mode runs only one server, so a separate small `web/server/http.mjs` listens on the HTTP port.
- **The HTTP page:**
  - Shows a **dismissible popup**: "Install the Yapp certificate for mic and app install", with a **Download CA** button.
  - Serves `/yapp-ca.crt` as `application/x-x509-ca-cert`, plus an optional iOS `.mobileconfig` as `application/x-apple-aspen-config`.
  - Gives per-OS steps, auto-selected from the user agent:
    - **Android:** Settings › Security › Encryption & credentials › Install certificate › CA certificate.
    - **iOS:** download in Safari, install the profile, then turn on full trust under General › About › Certificate Trust Settings.
    - **Windows:** `certutil -addstore Root`.
    - **macOS:** Keychain "Always Trust".
    - **Linux:** `update-ca-certificates` plus the NSS `certutil` command for Chrome.
    - **Firefox:** enterprise roots, or the hidden option on Android.
  - **"Continue to HTTPS"** button. "Don't show again" is remembered in localStorage.
- **Same download and instructions in the HTTPS app** under Settings › Devices.
- **Caveat:** on Android, Chrome's WebAPK install may fall back to a plain home-screen shortcut on a private LAN. Test this on a real device.

## 4. Repo layout
```
yapp/
  docker-compose.yml   # web (ports 80/443 or 8080/8443), voice-lab (gpus: all); volume ./data
  .env.example         # APP_PASSWORD_HASH, HOSTNAMES, LAN_IPS, OLLAMA_URL, OLLAMA_MODEL, WHISPER_MODEL
  web/
    astro.config.mjs   # svelte, node standalone, @vite-pwa/astro, tailwind
    scripts/certs.mjs  server/http.mjs  docker-entrypoint.sh
    src/middleware.ts
    src/db/schema.ts   # sessions, recordings, analyses, words, windows, drill_reps, levels, streaks, baselines
    src/lib/audio/     # recorder, pitch-worklet, vad, live-metrics (rolling ST SD), contour
    src/lib/{queue,ollama,scoring,dtw,progression}.ts
    src/data/          # drill sentences, stress sets, emotion lines, model phrases, word banks, challenges
    src/components/    # PitchCanvas, VariationMeter, ContourOverlay, Timer, Curveball, TranscriptPlayer, TrendChart, CertPopup
    src/pages/         # dashboard, daily, warmup, drills/[id], yap/[level], everyday, history, session/[id], settings, login
    src/pages/api/     # upload, sessions, session/[id], stats, jobs/[id] (SSE), ca
  voice-lab/
    Dockerfile  app.py  prosody.py  tests/
```

## 5. Build phases
1. **Scaffold:** git init; Astro + Svelte + Tailwind + Node adapter; Drizzle/SQLite; auth; cert script, HTTP landing popup and HTTPS boot; compose file; PWA manifest and service worker.
2. **Live audio:** recorder, AudioWorklet pitch/RMS, baseline calibration (a 60 s free-talk + reading sample), VariationMeter, PitchCanvas, IndexedDB offline queue.
3. **voice-lab:** Whisper + parselmouth + word-prosody alignment + DTW; job queue with SSE status.
4. **Metrics and session view:** fillers, rate, mean length of run, pause location, expressiveness score; transcript player with filler tagging (awareness training).
5. **Daily session and tonality drills:** warm-up, contrastive stress, model & match, free speech with meter, emotion/negative practice, progression engine with 80% mastery and feedback fading, weekly no-feedback test.
6. **Yap levels L1–L4 and extra modes:** shrinking retell, PREP timer, curveballs with TTS, LLM pivot/recovery analysis, level unlocks, streaks.
7. **Dashboard and everyday transfer:** trend charts (uPlot), streak calendar, real-life log, web push micro-challenges, LLM role-play partner.
8. **Polish:** mobile UX, export/delete, `data/` backup script.

## 6. Verification
- **Bring-up:** `docker compose up -d --build`.
- **HTTP popup:** open `http://<lan-ip>` on a phone, see the popup, download and install the CA, and continue to HTTPS with no warning.
- **Phone features:** getUserMedia works, and the PWA installs and loads its shell offline.
- **Certs:** `openssl x509 -text` on the leaf shows the SANs, EKU and validity. Restarting the container keeps the same root CA fingerprint.
- **Live meter:** a siren trace follows your voice. A deliberately flat read turns the meter red within about 10 s; an animated read turns it green.
- **Accuracy:**
  - pytest feeds voice-lab synthetic sine sweeps with a known ST range and synthetic stress peaks.
  - F0 stats on a real clip are compared against the Praat GUI.
  - A filler-heavy script gives the expected counts.
- **Stamina:** 4 s of silence in L1 is flagged. In L4, curveballs fire every 60–90 s via TTS and recovery latency is logged.
- **Offline:** record with the network off, reconnect, and the upload is analyzed.
- **Unit tests:** Vitest for scoring, DTW, progression/mastery rules, filler detection and level pass rules.
