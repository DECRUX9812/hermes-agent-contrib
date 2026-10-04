# Bot Room launch video — production plan

Companion to `storyboard.md` (v2 meta cut). Target: 88s, 120 BPM, hard cuts on bar boundaries.
Ships two masters: **1920x1080 (16:9)** and **1080x1920 (9:16)**.

This cut is a hybrid film: an **AI-generated world ("the Hexfield")** wraps around the real
screen recordings — the mascots are characters who present their own product on a
pane-within-the-world. The AI layer is therefore the *spine* of the edit, not garnish —
but it still never carries a product claim (every capability is proven in [REC] footage).

## 1. Toolchain

| Stage | Tool | Notes |
|---|---|---|
| Screen capture | `ffmpeg -f avfoundation -capture_cursor 1 -framerate 30 -i "Capture screen 0:none" raw.mp4` | Screen Recording permission already granted on the macOS VM. Hide the iPhone Simulator / local-network dialogs before rolling; Cmd+H anything floating. |
| Demo site | Real Chrome + unpacked `apps/browser-extension` on `devin/bot-room-extension`, dedicated demo Chrome profile already logged into GitHub/YouTube | The logged-in chrome (avatar, notifications) IS the proof — don't crop it out. |
| Bot replies | Mock backend on `127.0.0.1` serving canned responses (pattern: `docs/demo-kit/harness/demo_mock.py`) | Deterministic timing, zero flakiness mid-take. Page actions must be real. |
| Compositing / edit | HyperFrames project at `docs/demo-kit` — `#frame` 1728x960 inside 1920x1080, `cam()` punch-ins in source coords, `.frz` stills + `.fring` rings, helpers `type/scramble/slam/whip/flash/freeze/liveMark` | `npx hyperframes check .` before every render; render takes ~1min on hardware GPU. |
| Score | `films/<name>/score.py` — numpy WAV synth | 120 BPM, bar = 2s; risers+rolls before cuts, subdrop+impact on finale, `boom()` for mascot landings. `/tmp/score-venv/bin/python` has numpy+pillow. |
| AI film layer | **Nous Portal `$50` via Hermes `video_gen`** (funded lane — Tool Gateway → FAL families), **Higgsfield API** (Lipsync Studio for the talking mascot), **OpenRouter** (fallback single key) | See §3. Sora direct is dead; Sora 2 Pro still routes via OpenRouter. |
| QA | ffmpeg frame extraction + PIL pixel-scans for ring/still placement | Measure, never guess — every guessed position costs a render. |

## 2. Capture session checklist

1. `git checkout devin/bot-room-extension && cd apps/browser-extension && npm install && npm run build`, load unpacked in the demo Chrome profile.
2. Point the extension at the mock backend; configure 3 bots (distinct names → distinct mascot colors) + one room in `roundrobin`.
3. Pre-stage tabs: GitHub repo (logged in), GitHub issue, YouTube watch page, a docs site.
4. Rehearse each shot's action chain once without recording (rehearsal catches silent selector failures — the `ensureVisible` lesson).
5. **Slice footage into one mp4 per shot** — concurrent seeks into a single capture tear frames at screenshot time; per-shot files starting at media 0 fixed it completely.
6. Keep mascot ≥ ~300px on screen during capture where possible; a 40px mascot never reads at any punch — use `liveMark` (ring+stamp over live footage) rather than `freeze` when motion is the sell.
7. Cursor: capture it (`-capture_cursor 1`) — the cursor visibly *not* moving while the bot clicks is part of the flex.

## 3. AI film layer — provider, prompts, continuity

### 3.0 Provider status (as of Oct 2026)

| Model | API? | Approx cost / 10s | Verdict |
|---|---|---|---|
| **Veo 3.1** (Gemini API / Vertex) | ✅ GA since Nov 2025 | $0.40/s Std → **$4.00**; Fast $0.10–0.12/s → **$1.00–1.20**; Lite $0.05–0.08/s → **$0.50–0.80** | **Primary.** Native audio, 4/6/8s clips extendable +7s up to ~141s, first+last-frame control, 16:9 + 9:16. |
| **Kling 3.0** (Kling API / fal / Replicate) | ✅ | Units-billed; ~$0.05–0.15/s → **$0.50–1.50** | **Fallback + alt takes.** 3–15s native clips, up to 4K, optional native audio. Cheapest for iteration. |
| **Runway Gen-4.5 / Aleph 2.0** | ✅ | ~$0.50/s Gen-4-class → **~$5.00** | Skip for B-roll cost; Aleph is useful if we need to *edit* real footage (e.g. restyle a capture). |
| **Pika 2.2** | ✅ | ~$0.12/s → **~$1.20** (5s max) | Niche: creative melt/expand effects only; 5s cap is limiting. |
| **Nous Portal (funded — $50 credit)** | ✅ Tool Gateway — `video_gen` toolset in hermes-agent (`hermes tools` → Video Generation → provider `nous`) | Families live in-repo at `plugins/video_gen/fal/`: **Veo 3.1** (4/6/8s), **Seedance 2.0 / 2.5** (audio + lip-sync; 2.5 does 30s single-pass), **Kling v3 / Pro / 4K / O3** (3–15s), **PixVerse v6** (cheap), **Happy Horse** (multilingual lip-sync), plus **BFL FLUX 3** via `bfl_flux3_*`; OpenRouter/DeepInfra/xAI backends also in-repo | **Spend the existing $50 first.** Same balance as models/tools, no new account. Seedance 2.x + Happy Horse give us lip-sync without leaving Portal. |
| **Higgsfield API** | ✅ self-serve, `api.higgsfield.ai`, key + top-up balance | Kling 3.0 **$0.084–0.112/s**, Seedance 2.0 ~$0.14/s, MiniMax H3 ~$0.065/s, Wan ~$0.05–0.20/s; DoP camera model $0.125/gen | **Specialty lane:** Lipsync Studio (image→video talking on our real mascot render), Soul/Soul ID character images, DoP signature camera moves. |
| **OpenRouter** | ✅ `POST /api/v1/videos`, existing key/credits | Veo 3.1 / Fast / Lite, Kling v3.0 std/pro, Seedance 2.0/Fast, Wan 2.6/2.7, Hailuo 2.3, Sora 2 Pro — per-second pass-through | Fallback if Portal entitlements bite; also the only way to reach `sora-2-pro` post-shutdown. |
| **Sora 2 (direct)** | ❌ **API shut down 2026-09-24** | was $0.10/s | Not usable directly; still reachable via OpenRouter as `openai/sora-2-pro`. |

Cost plan (v2 meta cut): ~9 AI shots in the spine × ≤8s. Iterate prompts + continuity on **Kling 3.0 on **Higgsfield** (~$0.09/s — cheapest Kling seat), final world shots on **Veo 3.1 Fast @1080p** (~$1/clip) or Seedance 2.0. Dialogue shots go through **Higgsfield Lipsync** on our real mascot render (see §3.3/3.4 — cheap, and continuity is guaranteed because we animate *the actual asset*). Budget **$25–60** including retries — inside the user's existing credits if the "Nova Portal" balance covers a video gateway, otherwise a $50 Higgsfield/OpenRouter top-up covers the whole film with room for re-rolls.

### 3.2 Prompt-engineering rules for product-demo footage

- **Never ask the model to render real UI/text.** Generated "screens" still smear; keep UI abstract (glowing panels, blurred dashboards) and let the [REC] footage carry the product.
- **Image-to-video when a mascot must emerge from a real page**: feed the actual screenshot as first frame, prompt only for the emergence motion. Veo 3.1 first+last-frame interpolation is the reliable path for "sprouts out of the header."
- **Reserve negative space**: end prompts with "clean dark negative space in the upper third" wherever an on-screen callout will be overlaid.
- **One motion per prompt**: "slow push-in" OR "object rises" — stacking motions is the #1 cause of morphing artifacts.
- **9:16 natives, not crops**: regenerate the B-roll in 9:16 for the vertical master rather than cropping 16:9.

### 3.1 Verbatim prompts (one per storyboard shot)

**Shot 1 — the Hexfield, cold open (8s, 16:9 + 9:16)**
> Vast dark interior world inside a computer screen: an infinite floor of softly glowing hexagonal tiles stretches to the horizon under a translucent glass ceiling showing the blurry underside of a web page, small sleeping pod-lights dot the hexagons, slow drifting camera move, deep blue-black palette with faint amber accents, cinematic sci-fi minimalism, volumetric light, no text, no logos.

**Shot 2 — "it noticed you" (8s, 16:9 + 9:16)**
> Inside the dark hexagonal-tile world under a glass ceiling: a large translucent mouse cursor glides slowly across the ceiling like a shadow on the other side of glass; below, one small rounded chrome mascot character (use attached reference image) wakes in its pod, its eyes widen and track the cursor playfully like a cat watching a laser pointer, warm amber light grows, whimsical cinematic tone, shallow depth of field, no text.

**Shot 3 — "it's been waiting" (8s, 16:9 + 9:16) — dialogue shot**
> Same small chrome mascot (reference image) presses both stubby hands flat against the glass ceiling from inside the dark hexagonal world, looks directly into camera and smirks with playful confidence, says "we live here now" in a tiny cheerful robotic voice, warm amber rim light, close-up, cinematic, clean dark negative space upper third, no captions, no other text.

**Shot 3b — alt beat (8s)**
> Macro shot: a small glowing chrome droplet falls in slow motion onto a matte black glass surface shaped like a browser window, ripples of amber light spread outward, dark studio environment, shallow depth of field, cinematic product-film lighting, clean dark negative space in the upper third, no text, no logos.

**Shot 10 — "meanwhile, outside" (8s, 16:9 + 9:16)**
> View from inside the warm hexagonal world looking UP through the glass ceiling: outside the glass is a cold desaturated gray wasteland where a sad boxy remote-cloud robot repeatedly bonks its head against a floating frosted-glass checkbox wall it cannot pass, muffled distant thuds, our warm mascots (reference image) silhouetted below watching, melancholic comedy, cinematic, no readable text.

**Shot 11 — the graveyard freeze (6s, 16:9 + 9:16)**
> Still tableau for freeze-frame: the cold gray outside world — a dusty boxy robot frozen mid-motion holding a camera taking a screenshot of itself, cobwebs on its shoulders; beside it a terminal-shaped green-screen ghost trapped inside a text box; all under dim cold light, museum-diorama feel, deadpan comedy, wide shot, no readable text.

**Shot 12 — the glass high-five (8s, 16:9 + 9:16) — dialogue shot**
> Warm side of the glass: three small chrome mascots (reference image, three color variants) shrug sympathetically, one turns and gives a slow-motion high-five through the glass to a giant translucent human cursor on the other side — the cursor tilts as if smiling; one mascot says "he can't come in — no session" in a tiny pitying robot voice, warm amber lighting, gentle comedic tone, no readable text.

**Shot 14 — harness parade (8s, 16:9 + 9:16)**
> Wide shot of the hexagonal-tile world: six glowing doorways open in a row along the horizon — amber, cyan, violet, green, white, orange — and from each doorway a small unique chrome mascot (reference image, variant colors) steps out and joins a growing crowd walking toward camera, festival-parade energy, warm triumphant lighting, cinematic wide shot, no text on the doorways.

**Shot 16 — the face pile (8s, 16:9 + 9:16)**
> The whole cast of small chrome mascots (reference image, many color variants) tumbles into a joyful pile in the center of the hexagonal floor, the glass ceiling above shows a blurry real web page still glowing, camera slowly pulls back and rises, warm cozy lighting like a campfire scene, bittersweet-finale mood, no text.

**Shot 18 — post-credit peek (4s, 16:9 + 9:16)**
> A single small chrome mascot (reference image) peeks out from behind a floating dark logo card in the void of the hexagonal world, waves once at camera, ducks back, playful post-credits energy, warm single spotlight, no readable text.
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

### 3.3 Mascot continuity (the hard part)

The whole meta cut fails if the generated mascot doesn't match the real three.js mascot.
Workflow:

1. **Bake a reference sheet**: render the real mascot (screenshot the extension, transparent
   bg via `dom_hide` of the page or a solid-void dev page) → clean 1024px turntable
   (front, 3/4, side) on a neutral dark background. Design polish is a build-side input —
   the mascot surface has to be camera-ready before this sheet exists.
2. **Two continuity paths, by shot type:**
   - *Speaking shots (3, 12, 18)*: **image→video on Seedance 2.x / Happy Horse via Portal**
     (native lip-sync), or **Higgsfield Lipsync Studio** as specialty alt — animate the real
     mascot render itself. Zero drift: the output IS our character.
   - *Acting shots (2, 10, 14, 16)*: feed the reference as **first-frame image** — every
     Portal family supports image-to-video (`image_param_key` per family), Veo 3.1 also
     takes multi-asset references on Vertex. No exceptions.
3. **Lock a look-prompt suffix** reused verbatim in every prompt: `small rounded chrome
   mascot character, stubby arms, large simple eyes, toy-like proportions, warm amber
   accent light`.
4. Re-roll any take where the design morphs; budget 2–4 rolls per mascot shot.
5. Color variants (Hermes amber, Grok cyan, etc.) via the same reference + `variant in
   <color>` — deterministic color is the product's actual identity system, mirror it.

### 3.4 Mascot voice

- Max **3 spoken lines**, ≤8 words each: `we live here now` · `he can't come in — no session` · `roll it`.
- **Primary: Seedance 2.x / Happy Horse via Nous Portal** — image→video on the real mascot
  render, line in quotes + voice description ("tiny cheerful robotic voice"); both families
  ship native lip-sync and bill to the existing balance.
- Alt: **Higgsfield Lipsync Studio** (the specialist tool), or Veo 3.1 native dialogue on
  **Standard** tier.
- Fallback if speech is flaky: silent performances + text chips, or a tiny synthesized
  chirp + subtitle card (still charming, zero lip-sync risk).

### 3.5 Driving it from this session

Generation is scriptable two ways: (a) **Hermes itself** — sign into Nous Portal
(`hermes model` / `hermes setup --portal`), enable `video_gen` in `hermes tools`, call
`video_generate` per shot — spends the $50; or (b) one API key (OpenRouter/Higgsfield) →
`curl` the job, poll, download to the film dir. Either way I can run the full B-roll
batch from this session when we're ready to shoot — same loop as the rest of the pipeline.

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
| Duration | 88s (±2s fine); every cut on a 2s bar boundary |
| Loops | First frame = black + silence for clean social autoplay-in |

## 7. Build order

1. **Mascot reference sheet first** (§3.3) — it gates every AI shot.
2. Capture all [REC] shots against the mock backend (one mp4 per shot).
3. Score first (score.py) — the edit cuts TO the track, not the reverse; reserve the two
   dead-stops (shots 10–11) in the arrangement.
4. AI layer via Nous Portal $50: iterate on PixVerse v6 (cheap) → finals on Veo 3.1 /
   Kling v3-4K; dialogue shots on Seedance 2.x lip-sync.
   Lock shot 1 (the Hexfield establishing shot) first — every other AI shot inherits its grade.
5. HyperFrames assembly on the 16:9 master → `check` → render → frame QA. The [REC]-in-pane
   shots (7/8) composite real footage inside an AI-gen or MG pane frame.
6. 9:16 reframe pass; regenerate B-roll natively 9:16; re-check text safe areas.
7. Deliver both masters via `upload_attachment` (direct download links — not local paths).

## 8. Craft notes — what actually makes launch videos land (researched Oct 2026)

The classic reference is the original Devin demo (1.1M+ views, doubled the company valuation
inside a month). The repeatable recipe: **hook → look → trust**, plus one secret-sauce layer.

- **Hook = a disruptive claim, not a pitch.** "We built this thing, please check it out" is the
  #1 fail mode. Our hook is structural envy: every other agent dies at the login wall — ours was
  born behind it. Lead with the *claim*, never the feature list.
- **Look = show the mechanism, don't call it magic.** AI demos die on "too good to be true."
  The [REC] footage exists precisely to prove the mechanism — logged-in tab, real cursor, real
  page actions. Never let an AI-generated shot *imply* a product behavior it can't do.
- **Trust = real UI only.** Invented labels/buttons are the #1 tell of a fake demo. Every [REC]
  shot uses the real extension on real pages; captions are burned in for muted viewers.
- **Product on screen within 3 seconds** of the cold open — the Hexfield pane shows the real
  demo at shot 7 but the *product claim* (logged-in drive) lands by ~0:14.
- **Mascot consistency is the whole game** (the reference-sheet discipline): 3–5 distinctive
  describable features per bot, flat bold color regions, no fine text/logos on the character
  (small type is the most fragile element in generation), canonical turnaround sheet fed as
  `image_url`/`reference_image_urls` to every AI shot. A mascot that drifts between shots reads
  as clip art; one that holds becomes a recognition machine.
- **Distribution is part of the video.** Ship both masters; the 9:16 reframe isn't a letterbox,
  it's re-composed. First frame black+silent for clean autoplay.

## Risk notes

- **If the extension isn't camera-ready**: shots 4/8 degrade gracefully — capture the mascot on any live page and the compose-into-comment flow on a GitHub test repo. Do NOT fake the logged-in state; that beat is the claim.
- **If mascot continuity fails** (3+ failed re-rolls per shot): ship the v1 fallback cut (storyboard.md bottom) — same REC spine, MG cards instead of AI world. The film survives; the meta layer doesn't ship broken.
- **Mock only the replies**: `demo_mock.py`-style canned turns keep timing deterministic; all `page_action`s stay real so motion on screen is honest.
- **Sora is off the table** (API shut down Sept 2026) — anyone citing Sora pricing in a plan is working from stale info.
- **Portal auth**: `sk-nous-*` inference keys do NOT authenticate the Tool Gateway video lane
  (verified 401 Oct 2026) — generation needs the OAuth token from `hermes setup --portal`
  (`~/.hermes/auth.json` → `access_token`, or `TOOL_GATEWAY_USER_TOKEN` env). Submit script:
  `docs/bot-room-video/scripts/nous_video_gen.py`.
