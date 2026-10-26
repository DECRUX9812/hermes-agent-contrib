# BB-pattern plan: Onboarding + Bot Mode v3

Status: approved direction from DECRUX9812 (2026-10-25). Code lands on `overlay/core-patches`
(hermes-overlay-core) and in this repo, shaped for a PR to `DECRUX9812/hermes-agent-contrib`.
Never Nous main.

## Track A: Onboarding (3 steps, then the composer)

| Step | What the user sees | Built on |
|---|---|---|
| 1 Identity | Nous Portal device code (one click, code shown big, auto-poll). Credits and profiles appear as soon as it lands. Optional "Connect GitHub" (device code, no terminal). | existing provider OAuth + `free_tier.*`; new `/api/setup/github/*` driving `gh auth login --web` |
| 2 Model / credits | Default model card with price and credit balance, one "Change" picker | existing `confirming_model` panel + model options |
| 3 Remote access | "Only this computer" or "Anywhere (Cloudflare)". One click starts a Quick Tunnel and turns on Web Access with Nous sign-in. Custom domain = paste your URL. | new `/api/setup/tunnel/*` + existing `/api/webapp-access/start` (public mode) |
| then | The prompt composer, focused, with 3 starter prompts | existing composer |

Rules kept:
- Remote access changes stay native-only (`owner_on_this_machine`). In the browser webapp, step 3 shows the current address read-only.
- A tunnel never starts without the sign-in gate: Web Access public mode requires a Nous account.
- Every step except the model can be skipped. "Set up again" lives in Settings.
- Quick Tunnel URLs change when cloudflared restarts. Status reports `stale` and offers "Refresh".

## Track B: Bot Mode v3 (BB roles and teams)

Stop extending the fork's virtual room and the 24 `bots_team.*`/`bots_mailbox.*` RPCs. v3 is a new
plugin on core primitives:

| BB concept | Hermes primitive |
|---|---|
| Role (analyst, developer, reviewer, qa, researcher, writer) | profile template: `SOUL.md` + model/provider + toolsets + avatar in `ui_meta` |
| Bot | a profile created from a role. Keeps the one canonical "Bot Chat" per bot (desktop AGENTS.md invariant) |
| Team template (`feature`, `research-brief`) | a small YAML DAG: steps with role, `needs`, `final` |
| Team run | one kanban board run: one task per step, assignee = the role's profile, `parents` = `needs`, `model_override` from the role |
| Handoff | parent task results/comments flow to children (kanban comments + attachments) |
| Lanes / fleet dashboard | status cards from kanban task state + worker liveness + `subagent.list`, live via gateway events |
| Inter-bot messages | kanban comments on the run, and `bot_relay` for direct bot-to-bot DMs. No mailbox polling. |

Default teams (mirroring `bb role teams`):
- feature: plan (analyst) -> build (developer) + tests (qa) -> review (reviewer) [final]
- research-brief: primary (researcher) + practice (researcher) -> brief (writer) [final]

Delivery order:
1. Track A backend + tests, then Track A renderer + tests. Rebuild :9120.
2. Track B: roles + team templates + `team.run` -> kanban (backend, tests).
3. Track B: lanes dashboard + role picker + run view (renderer, tests).
4. Retire hermes-bots-plus (v2) once v3 covers chat + teams. Its data stays readable.
