# Bot Room — friendly dunk sheet

Cheeky, not nasty. Every claim about a competitor should be defensible — the dunk works
because it's *true*, not because it's mean. Rows are ordered so the table builds to the
kill shot (row 4).

| | **Bot Room** | **T3 Code** | **Browser Use** | **OpenAI Operator** | **Claude computer use** | **"Agent in a tab"** (bare LLM + Playwright) |
|---|---|---|---|---|---|---|
| **1. Where the agent lives** | On the page. Every page. As a tiny 3D guy you can drag around | In its own desktop/web/mobile control surface | In your terminal, driving a browser over there | In a cloud browser that belongs to OpenAI | On your whole desktop, pixel by pixel | In whichever tab you remembered to attach |
| **2. How many harnesses can check in** | Hermes, Grok/xAI, OpenClaw, Muse personas, any OpenAI-compatible endpoint, CLI/ACP slot — ~40-line adapter | Claude Code, Codex, Cursor, Grok Build, OpenCode, Antigravity | Whatever model you wire into the framework | One (OpenAI's) | One (Claude) | One, and you babysit it |
| **3. Bots that can hang out together** | Rooms — group chats that relay, @mentions, round-robin, shared scratchpad to pass notes | Many agents, many threads — but they don't talk to each other | One browser, one task, one agent | One task per session | One cursor, one very focused employee | lol |
| **4. Whose login it drives** | **Yours — it IS your browser. There is no handshake to fail.** | Yours — local CLIs, local creds (this is genuinely good) | Depends where you point it | Theirs — a remote browser that isn't logged in as you | Yours, via screenshots and prayers | Yours, until the cookie dies |
| **5. CAPTCHA encounter** | "Oh, that's my owner's account." *walks through the wall* | Rarely sees one — stays in the dev lane | Hits it, retries it, becomes content | The famous pause — "please take control and prove you're human" | Clicks the crosswalks one pixel at a time | Times out on step 3 of 40 |
| **6. What it looks like doing its job** | A mascot performing a little dance on your repo | A very nice kanban of threads | A numbered-elements inspector | A video of a browser in a box | A screenshare of a screenshare | A wall of JSON in a terminal |
| **7. Talks back via** | Chat bubbles on the page + **voice input** on every panel | Text threads, synced to your phone | Stdout, eventually | Chat sidebar in the remote view | Text box in the harness | The API response |
| **8. Party trick** | Bots pass each other notes and split the work in parallel on live pages | One button: branch → PR | Watches an agent book flights in ~7 seconds | Orders groceries *for* you (after you log it in) | Once got distracted by Yellowstone photos mid-demo — real, endearing | `TimeoutError: waiting for selector` |
| **9. The honest asterisk** | Chrome MV3, needs the unpacked load or store listing; mutating actions are serialized per tab so bots don't stomp | It's a control *surface* — the agents still live in terminals | A framework, not a product — bring your own everything | Killed/absorbed into ChatGPT agent — the remote-browser model itself got retired | A capability API, not a product you install | You built it, you maintain it |

## In the film — the mock beat personified

The video's Act III turns this table into characters on the cold side of the glass
(archetypes, not logos — the caption does the tagging):

- **The cloud-bot** (Operator/Mariner archetype) — repeatedly bonks into a CAPTCHA wall it can't pass; holds up a blurry checkbox grid like a hostage sign.
- **The pixel-reader** (computer-use archetype) — frozen mid-screenshot of itself, cobwebbed, one photo of Yellowstone in hand.
- **The terminal ghost** (bare agent-in-a-tab) — trapped inside a green text box, muttering `TimeoutError`.
- **Inside the glass:** our mascots, warm, logged in, passing notes. One waves sympathetically: `he can't come in — no session`.

## The one-liner, for comments and captions

> Everyone else built a better room for the agent to sit in. We moved the agent into yours.

## Usage notes

- Lead with **row 4** (session) and **row 3** (rooms) in any text post — those are the two differences nobody else can claim today.
- Row 5's CAPTCHA gag is the video's cold dunk — same joke, two formats.
- Keep it warm: T3 Code's "your creds, your machine" is philosophically our closest cousin — dunk on the *surface*, not the sovereignty. Operator/Mariner/computer-use are the "remote babysitting" archetype; that's where the comedy lives.
- Row 9 is self-aware on purpose — naming our own asterisk first defuses the replies.
