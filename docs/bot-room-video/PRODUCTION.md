# Bot Room launch video — production plan

Companion to `storyboard.md`. Target: 78s, 120 BPM, hard cuts on bar boundaries.
Ships two masters: **1920x1080 (16:9)** and **1080x1920 (9:16)**.

## 1. Toolchain

| Stage | Tool | Notes |
|---|---|---|
| Screen capture | `ffmpeg -f avfoundation -capture_cursor 1 -framerate 30 -i "Capture screen 0:none" raw.mp4` | Screen Recording permission already granted on the macOS VM. Hide the iPhone Simulator / local-network dialogs before rolling; Cmd+H anything floating. |
| Demo site | Real Chrome + unpacked `apps/browser-extension` on `devin/bot-room-extension`, dedicated demo Chrome profile already logged into GitHub/YouTube | The logged-in chrome (avatar, notifications) IS the proof — don't crop it out. |
| Bot replies | Mock backend on `127.0.0.1` serving canned responses (pattern: `docs/demo-kit/harness/demo_mock.py`) | Deterministic timing, zero flakiness mid-take. Page actions must be real. |
| Compositing / edit | HyperFrames project at `docs/demo-kit` — `#frame` 1728x960 inside 1920x1080, `cam()` punch-ins in source coords, `.frz` stills + `.fring` rings, helpers `type/scramble/slam/whip/flash/freeze/liveMark` | `npx hyperframes check .` before every render; render takes ~1min on hardware GPU. |
| Score | `films/<name>/score.py` — numpy WAV synth | 120 BPM, bar = 2s; risers+rolls before cuts, subdrop+impact on finale, `boom()` for mascot landings. `/tmp/score-venv/bin/python` has numpy+pillow. |
| AI B-roll | **Veo 3.1 via Gemini API** (primary), **Kling 3.0** (fallback / alternate takes) | See §3. Sora is dead (below). |
| QA | ffmpeg frame extraction + PIL pixel-scans for ring/still placement | Measure, never guess — every guessed position costs a render. |

## 2. Capture session checklist

1. `git checkout devin/bot-room-extension && cd apps/browser-extension && npm install && npm run build`, load unpacked in the demo Chrome profile.
2. Point the extension at the mock backend; configure 3 bots (distinct names → distinct mascot colors) + one room in `roundrobin`.
3. Pre-stage tabs: GitHub repo (logged in), GitHub issue, YouTube watch page, a docs site.
4. Rehearse each shot's action chain once without recording (rehearsal catches silent selector failures — the `ensureVisible` lesson).
5. **Slice footage into one mp4 per shot** — concurrent seeks into a single capture tear frames at screenshot time; per-shot files starting at media 0 fixed it completely.
6. Keep mascot ≥ ~300px on screen during capture where possible; a 40px mascot never reads at any punch — use `liveMark` (ring+stamp over live footage) rather than `freeze` when motion is the sell.
7. Cursor: capture it (`-capture_cursor 1`) — the cursor visibly *not* moving while the bot clicks is part of the flex.

## 3. AI-generated B-roll — provider + verbatim prompts

### Provider status (as of Oct 2026)

| Model | API? | Approx cost / 10s | Verdict |
|---|---|---|---|
| **Veo 3.1** (Gemini API / Vertex) | ✅ GA since Nov 2025 | $0.40/s Std → **$4.00**; Fast $0.10–0.12/s → **$1.00–1.20**; Lite $0.05–0.08/s → **$0.50–0.80** | **Primary.** Native audio, 4/6/8s clips extendable +7s up to ~141s, first+last-frame control, 16:9 + 9:16. |
| **Kling 3.0** (Kling API / fal / Replicate) | ✅ | Units-billed; ~$0.05–0.15/s → **$0.50–1.50** | **Fallback + alt takes.** 3–15s native clips, up to 4K, optional native audio. Cheapest for iteration. |
| **Runway Gen-4.5 / Aleph 2.0** | ✅ | ~$0.50/s Gen-4-class → **~$5.00** | Skip for B-roll cost; Aleph is useful if we need to *edit* real footage (e.g. restyle a capture). |
| **Pika 2.2** | ✅ | ~$0.12/s → **~$1.20** (5s max) | Niche: creative melt/expand effects only; 5s cap is limiting. |
| **Sora 2** | ❌ **API shut down 2026-09-24** | was $0.10/s | Not usable. Do not plan around it. |

Cost plan: ~6 B-roll shots × ≤8s on **Veo 3.1 Fast @1080p ≈ $1/clip** → ~$6–10 with retries. Iterate prompts on **Kling** (cheaper), final renders on Veo.

### Prompt-engineering rules for product-demo footage

- **Never ask the model to render real UI/text.** Generated "screens" still smear; keep UI abstract (glowing panels, blurred dashboards) and let the [REC] footage carry the product.
- **Image-to-video when a mascot must emerge from a real page**: feed the actual screenshot as first frame, prompt only for the emergence motion. Veo 3.1 first+last-frame interpolation is the reliable path for "sprouts out of the header."
- **Reserve negative space**: end prompts with "clean dark negative space in the upper third" wherever an on-screen callout will be overlaid.
- **One motion per prompt**: "slow push-in" OR "object rises" — stacking motions is the #1 cause of morphing artifacts.
- **9:16 natives, not crops**: regenerate the B-roll in 9:16 for the vertical master rather than cropping 16:9.

### Verbatim prompts (one per storyboard shot)

**Shot 3 — "the seed" (8s, 16:9 + 9:16)**
> Macro shot: a small glowing chrome droplet falls in slow motion onto a matte black glass surface shaped like a browser window, ripples of amber light spread outward, dark studio environment, shallow depth of field, cinematic product-film lighting, clean dark negative space in the upper third, no text, no logos.

**Shot 6 — "CAPTCHA death wall" (4s, 16:9 + 9:16)**
> A translucent robotic hand reaches toward a floating wall of frosted glass panels, each panel showing a blurry grayscale checkbox grid; as the finger touches the wall the panels crack with thin fracture lines and desaturate to cold gray, dramatic low-key lighting, shallow depth of field, ominous but clean sci-fi product aesthetic, no readable text, no logos.

**Shot 15 alt fill — "harness cards" ambient texture (optional, 4s)**
> Slow lateral dolly across a row of small glowing character figurines made of brushed chrome and colored glass — amber, cyan, violet, green — each softly pulsing on a dark pedestal, black void background, premium product-ad lighting, clean negative space above, no text.

**Shot 16 — "the graveyard" (6s, 16:9 + 9:16)**
> Wide shot of abstract translucent gray monoliths half-sunk in dark fog, each monolith has a faint blurred grid pattern like a defunct interface, a single warm amber light sweeps past them from right to left leaving them dark, cinematic minimalism, heavy atmosphere, no readable text.

**Alt — "page comes alive" take B (8s)**
> Top-down view of a flat matte-black surface resembling a dark web page; a small rounded creature made of folded iridescent chrome pushes up through the surface from below as if the page were fabric, stretches, and pops free, landing with a soft squash, playful but premium lighting, clean negative space top third, no text.

**Alt — office/hands ambience (6s, if a human-hands beat is wanted before the cold open)**
> Close-up of hands resting beside a keyboard, motionless, while the monitor beyond them glows and subtly shifts on its own, shallow focus on the still hands, dark room, amber screen glow, cinematic, no readable text on screen.

## 4. Motion-graphic / text card specs

- Canvas: 1920x1080 master; `#frame` content area 1728x960 (10% outer margin = broadcast-safe).
- Type: **'Avenir Next Condensed'** for slams/callouts, **Menlo** for chip/terminal accents — both pass `hyperframes check` via `local()` @font-face (Montserrat is NOT on this Mac).
- Callout chips: dark `#0d1014` bg + amber text (AA — amber bg + dark text fails 4.41:1).
- Intentional stacked headlines → `data-layout-allow-overlap`; outline-only text → `data-layout-ignore`.
- Cursor-driven highlights must tween `x/y`, never `left/top`.
- Every callout ≤ 9 words, sentence case, lands on the downbeat it references.

## 5. Music direction

- 120 BPM percussive, dry close-mic'd kit feel (think wood/metal foley drums, not EDM); sub hits reserved for mascot landings and the logo.
- Structure maps to the score.py plan keys: `risers` before each whip, `booms` on shots 4/8/18/19, dead-stop (all stems muted) for the 4s CAPTCHA beat — the silence is the joke.
- Optional ear candy: pin bot "voices" as pitched rim pips — L/R pan per bot in the room scene.
- Loudness target **−14 LUFS integrated**, true peak −1 dBTP.

## 6. Export spec

| Master | Spec |
|---|---|
| 16:9 | 1920x1080, 30fps, H.264 High@L4.2, ~12 Mbps, AAC 320k, −14 LUFS |
| 9:16 | 1080x1920, same codec/audio; reframe — don't letterbox. Mascots + callouts re-composed per shot; B-roll regenerated natively 9:16. |
| Duration | 78s (±2s fine); every cut on a 2s bar boundary |
| Loops | First frame = black + silence for clean social autoplay-in |

## 7. Build order

1. Capture all [REC] shots against the mock backend (one mp4 per shot).
2. Score first (score.py) — the edit cuts TO the track, not the reverse.
3. HyperFrames assembly on the 16:9 master → `check` → render → frame QA.
4. AI B-roll last, only for the 4 dramatization shots; drop into the same timeline.
5. 9:16 reframe pass; re-check text safe areas.
6. Deliver both masters via `upload_attachment` (direct download links — not local paths).

## Risk notes

- **If the extension isn't camera-ready**: shots 4/8 degrade gracefully — capture the mascot on any live page and the compose-into-comment flow on a GitHub test repo. Do NOT fake the logged-in state; that beat is the claim.
- **Mock only the replies**: `demo_mock.py`-style canned turns keep timing deterministic; all `page_action`s stay real so motion on screen is honest.
- **Sora is off the table** (API shut down Sept 2026) — anyone citing Sora pricing in a plan is working from stale info.
