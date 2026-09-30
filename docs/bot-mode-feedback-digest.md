# Bot Mode feedback digest — September 2026

Compiled from Discord + X/Twitter (via Ritesh), GitHub issues/PRs on NousResearch/hermes-agent, Hacker News, and third-party comparisons (dev.to, firecrawl, zentor, agent37). Reddit search surfaced little first-party Bot Mode content — the complaint surface lives on X, Discord, and GitHub. Discord is not scrapable; the quoted thread was provided by the user.

## Theme table

| # | Theme | Independent mentions | Representative quote | Surface |
|---|-------|---------------------|----------------------|---------|
| 1 | Side chats lose bot powers / forever-chat context bloat | 3+ (Nate DOOM thread; Mark_Edgeller X; Cali_Creed X) | "why would I want it to send a ton of useless context from previous conversations? … I wish I could open a new session but still be talking to my main bot" | session model |
| 2 | Setup friction / mental model confusion | 5+ (Mats, MastLob, linzhi_xia, yotamha1, ThomasBekkers) | "i want a 'create bot' button and have it 'just work'", "profiles and bots use the same… i got confused" | onboarding, roster pane |
| 3 | Only the orchestrator should listen | 2 (Nate, Myth thread) | "only if a single bot is listening to me and not 5 of them — I'm not trying to 5x my token use" | group chats |
| 4 | Bots impersonating user / each other | 1 strong (CravingHumanity) + maintainer-known | "trying to get them to cooperate and not impersonate me or each other is a huge problem" | relay/attribution |
| 5 | Turn cap kills group chats mid-flow | 2+ (Mark_Edgeller + GitHub PR discussion) | "the turn cap stops you mid-floe every few messages" | group engine |
| 6 | >5–6 bots in a chat is a drawback | 1 (CravingHumanity) | "The 6 bots in a chat is a huge drawback as well" | group engine (cap 6) |
| 7 | Model switching is clunky | 1 (CravingHumanity) | "the extra steps to constantly switch models in the configs is clunk" | bot config UX |
| 8 | Starter bots / templates | 2 (THEREALCHIVAS, witcheer) | "a couple 'general' bots to start with would be cool" | onboarding |
| 9 | Mobile app + desktop↔VM handoff | 3 (RenosBlog, ThomasBekkers, alexhvnsen) | "Seamless context handoff from desktop to VM and vice versa with the same bot. Mobile app" | platform |
| 10 | "Extra simple" / grandma mode | 2 (yotamha1, alexhvnsen) | "doesn't have a grandma mode yet", "An 'extra simple' mode in the desktop" | product shape |
| 11 | Lead bot should create the team | 1 (Anutaro) | "Main bot needs to be able to create the bot team" | orchestration |
| 12 | Slow / glitchy / load times | 4+ (Bendabal_rock, vienothm, twojewoda, ThomasBekkers) | "takes long to load at times", "bot mode keeps glitching" | reliability |

## Maintainer-tracked bug classes (umbrella #94726, Aug 2026 sweep)

Teknium's own tracker groups ~80 open items — the classes most relevant to this push:

1. **Canonical identity & resolution** — retitle breaks resolution, hidden rows invisible to session APIs (#92473, #90458, #94609, #92377, #88918, #91827).
2. **Roster rendering & stale overlay** — spins/hangs, resurrect-after-delete (#92830, #92794, #92843, #94235, #93917).
3. **Session routing & transcript staleness** — biggest cluster by volume: wrong-profile opens, blank transcripts, lost history (#92454, #91579, #93856, #93604, #93942, #90528, #89989).
4. **Remote/SSH/multi-connection** — remote rows second-class; wrong-gateway routing (#94648, #93734, #93235, #89811, #89756, #89729, #89843).
5. **Group chat engine** — @mention continuation never schedules cited member, sentinels render, no cancel, poll-driven replies (#94478, #94376, #94308, #92003, #90420, #93813, #93947, #92760, #91868, #90853).
6. **A2A/message_agent delivery** — non-default profile relay fails, 30s timeout abandons deliveries, Telegram auth blocks bot-authored messages, no loop guard (#93935, #93911, #94018, #92840, #91481), plus #95074: two reply paths for one message_agent call.
7. **Routines pane**, **gateway/platform deliveries**, **onboarding/UX**.

Standing maintainer rulings (per #94726): canonical identity = (profile, title "Bot Chat") — no session-id pin; connections are the peer set; mention middleware identifies, never delivers (A2A via message_agent). Our bot-topics work conforms: topics share powers, never identity.

## Turn-cap prior art (upstream)

- PR #92213 — per-room overrides for GROUP_CHAT_MAX_ROUNDS/MESSAGES/MEMBERS/HISTORY (defaults 3/10/6/24), with a switchable safety brake (50 rounds/200 messages). Documents the real arithmetic: at 6 members the message cap binds before round 2 ends.
- PR #98047 — drives room limits from a `group_chat` block in config.yaml, clamped (20/100/20), unset→defaults.
- Docs confirm: 3 serial rounds, 10 messages per send, 6 members, 10-minute per-turn cap; room settles on a silent round.

## Delivery/liveness prior art

- PR #100544 — Bot Mode DMs handed to the existing live owner (durable pending→claimed handoff) instead of spawning a competing CLI owner that fails with "already has a live owner".
- Issue #92760 — group replies are poll-driven (GROUP_TURN_POLL_MS=2s, 3-min base timeout, 20-min hard cap); stale provider locks in model_config silently break group injection until restart.

## Comparisons worth mining for UX

- OpenClaw praised for: 24+ channels, native iOS/Android apps w/ approvals, one-click skill installs (ClawHub), managed hosting — i.e., the "just works" layer Hermes lacks.
- Hermes praised for: stability, actual memory, footprint, speed on small boxes.
- dev.to verdict: Bot Mode wins for repeated knowledge work; standalone chats win for ad-hoc — exactly the "topics with powers" middle ground this work adds.

## Gaps NOT in the user's pasted feedback (proposal candidates)

- Bot DMs vanish while the canonical chat is open in Desktop (#95074, #100544 class) — arguably the most damaging "impersonation-adjacent" bug: replies appear under the wrong surface.
- Roster hangs/spins classes (#2) — likely invisible to users as "glitchy" (theme 12).
- No way to see what a bot WILL do with your message before it does (transparency) — implied by "polished bot experience" asks.
- Group @mention continuation never runs the cited member (#94478) — directly contradicts the feature's promise.

## Status on the fork (Sep 30 2026)

What the Sep 29 X thread and the Discord thread asked for, and where each landed. "Fork" means
`DECRUX9812/hermes-agent-contrib`, merged on branch `claude/trusting-euler-pcr2bv`.

| # | Theme | Status | Where |
|---|-------|--------|-------|
| 1 | Fresh chat, same bot powers; forever-chat bloat | **Shipped** | #120 bot topics (powers set once at create — cache-safe), #121 long-context "New topic" nudge, #124 "New topic" is the main action |
| 2 | Setup friction / mental model | **Shipped (desktop)** | #123 one-click "New bot" (name only, clones a working model), #124 "How bots work" explainer and a card showing model, skills and teammates |
| 3 | Only one bot should listen | **Shipped** | #127 team rooms listen through the lead; follow-up: any room can pick "Who listens" (one bot, everyone, or auto) |
| 4 | Impersonation | **Shipped** | #126 attribution comes from the plumbing, and forged `Name (user):` / DM stamps / `[task …]` lines arrive quoted; follow-up narrowed the match so code like `def f(user):` passes through untouched |
| 5 | Turn cap mid-flow | **Shipped** | #125 per-room budget + `group_chat` config block; running out pauses ("send a message to keep going") and only the hard ceiling stops a runaway |
| 6 | 6 bots in a chat | **Mitigated** | #3 above: the other bots stay asleep until addressed, so size no longer multiplies cost |
| 7 | Model switching is clunky | **Shipped** | One-click model chip in the Bot Chat header and roster card (G7); the Bots-pane card's model is now the same switcher (no config files) |
| 8 | Starter bots | **Shipped** | #123 Scout / Forge / Pilot one-tap starters in the empty roster |
| 9 | Mobile, desktop↔VM handoff | Open (larger) | Existing pieces: `hermes://session/open` handoff (#77), `hermes peer`; a mobile client is out of scope for this pass |
| 10 | Extra-simple mode | Partial | #123 / #124 cut the path to a working bot to one click; a dedicated simple mode is still open |
| 11 | Lead bot creates the team | **Shipped** | `hermes bots create/list` + `hermes bots team create/add/show` and the bundled `bot-team-builder` skill (the main bot proposes a team, from history when the ask is vague, then builds it) |
| 12 | Slow / glitchy | Needs repro | Not reproducible in CI sandboxes; needs traces from affected installs (roster spin and routing classes in #94726 are the likely causes) |
| — | Bots can't be pointed at projects | **Shipped** | "New topic in a project…" on the bot card starts a bot topic in a chosen project folder |
| — | Plugins that feel native (OpenAI MCP Extensions parity) | Designed | `docs/desktop-mcp-apps-host-proposal.md`; building next |

## Interface principles (community input, Sep 30 2026)

From Suzu (paraphrased, their own opinions): "our UX paradigms for interacting with agents are
a mess", and open source is universally weak at UX. What that asks of Hermes, and where each
stands:

| Principle | What it means for Hermes | Status |
|---|---|---|
| Continuity across venues | One bot, one conversation, whether the user is on the Desktop, a phone chat app, or a future surface | Partial: bot identity is venue-independent (Bot Chat title identity; `hermes://session/open` handoff; live-owner delivery). A mobile client is still open |
| Output shaped by the venue | No code blocks by default on phones; tables only where they render | **Shipped for chat apps**: WhatsApp / Telegram / Signal hints now carry a phone-first rule (code blocks only for text to copy). Existing conversations keep their stored prompt; new ones get it |
| Venue awareness per turn | When one conversation is reached from several venues, the agent should know where THIS turn came from | Open. Must ride the turn's user message as a short marker, never the system prompt (prompt caching) |
| Artifacts as composable interface | Agents take in and emit UI pieces, and can verify what they composed | In progress: MCP Apps inline (slice 1 shipped); next slices add model context from apps, panels and forms (`docs/desktop-mcp-apps-host-proposal.md`) |
| Fleet view | One easy screen for what every bot is doing (UniFi-style: device grid → drill-down) | Open. Building blocks exist (roster presence, HUD run cards, Team rollups, cost analytics); needs one overview page |
