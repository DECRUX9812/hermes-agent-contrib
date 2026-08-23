# Bot Mode Product Convergence Report

## Verdict

**The product direction is now clear and one upstream-ready correctness slice is finished.**

The “harness war” should not end in a new Mission engine, fleet scheduler, task database, or Workbench shell. Current Hermes already has the right product waist:

```text
Chat = relationship and live steering
Bots = named profiles — who does the work
Projects = workspace/cwd authority
Sessions + delegation + kanban + cron = execution truth
Browser / Computer / Files / Review / Terminal = contextual work surfaces
```

Execution harnesses remain implementation details. A Bot is still one profile with one canonical `(profile, session titled exactly "Bot Chat")` forever-chat.

## Inventory: where the last two weeks landed

| Source | Current status | Decision |
|---|---|---|
| Current `NousResearch/hermes-agent` bundled Bot Mode | Active implementation; bundled by merged PR #87886; current suite reached 415 tests | **Sole merge target** |
| Archived standalone `Hermes-Bot-Mode`, `pr56-vr` / `72e6e80` | Valuable historical control-surface ideas, but old handoff/fleet architecture | **Selective idea/test salvage only** |
| `~/Code/hermes-squad`, `f69100a` | Real 92-mandate audit, RC fixes, 167-test prototype, verified demo; separate web app | **Regression corpus and UX evidence, not an upstream merge** |
| `~/Code/hermes-final-merge2` | Mission prototype with 139 focused Mission tests and strong presentation contracts, but thousands of commits divergent and a second engine | **Reject implementation merge; retain contracts/evidence** |
| Workbench V2 research | Strong context-spine, contextual-drawer, empty-state, and environment-label ideas; contradicts current chat-first Desktop if taken wholesale | **Research only; no shell rewrite** |
| Archived PR #56 fleet-dispatch/digest/policy | Duplicates schedulers/approval/routing and no longer matches current `message_agent` architecture | **Reject** |
| Consolidated `SWARM-FINDINGS.md` | 103 deduplicated RC findings, especially honesty, identity, attention, reconnect, a11y, performance | **Regression backlog** |

## What current main already solved

This is why the older branches must not be merged wholesale:

- Bot Mode is bundled and on by default.
- Canonical Bot Chat identity is name-based; stored session-ID pins are explicitly prohibited.
- New Agent creation can mirror credentials/auth, inherit model/provider, and preserve voice/config readiness.
- `tools/bot_mode_probe.py` injects the teammate protocol only into canonical Bot Chats.
- Bot prompts already include teammate handles and role/description lines.
- A capability fingerprint refreshes eternal Bot Chat prompts once when roster, roles, SOUL, skills, toolsets, MCPs, or peers change.
- `message_agent` is Bot-Chat-only, validates the live roster, uses temp-file transport with quoting, and returns asynchronously.
- Group chat already has bounded rounds, attachments, clarification/approval cards, threading, persistence, cross-connection routing, and truthful failure/activity arcs.
- The current bundled plugin had **406/406** tests green before this pass; current main plus newer relay coverage reached **415/415** after integration.

## Bot setup / teammate-awareness decision

**Do not inject mutable “what everyone is doing now” state into the cached system prompt.** That would create prompt-cache churn and stale truth.

The correct split is:

- **Static, cache-safe:** teammate names, roles, how to discover/message them — already implemented through `bot_mode_probe` and its capability epoch.
- **Dynamic:** working/needs-input/unread/activity — read from renderer/backend state at runtime and shown in Bot Mode, not embedded in SOUL or the long-lived prompt.
- **Coordination:** `message_agent` asks the relevant teammate directly; current work remains authoritative in its session/delegation/kanban record.

No further SOUL templating is needed for this slice. The important improvement was making live attention/status truthful.

## Shipped implementation slice

Current-main PR branch:

```text
/home/decrux/Code/hermes-bot-attention-pr
branch: fix/bot-mode-attention-truth
commit: 3a4f1a4c5d
base: origin/main 30d4555085
```

### Behavior

1. Adds a content-free `$awaitingInputSessionIds` union across clarify, approval, sudo, and secret prompts.
2. Exposes it read-only to plugins as `host.state.awaitingInputSessionIds`.
3. Adds a **Needs you** strip and per-row badge only when a bot's canonical Bot Chat durable ID or resolved lineage tip is genuinely parked on input.
4. Hidden bots with urgent input still pierce the hidden roster filter.
5. Side-chat prompts stay in Sessions and never change the canonical bot-row target.
6. Replaces heuristic “Active now” with **Working now** backed by exact `host.state.busyBySession` or live kanban/tool worker heartbeats.
7. A recent completed message still updates timestamp/unread, but no longer animates the bot as working.
8. Feature-detects both new SDK atoms so older runtime-plugin hosts remain usable without false claims.
9. Removes the native `title` tooltip from working chips and adds a descriptive `aria-label`.

### Verification

- Bundled Bot Mode on current PR base: **415 passed, 0 failed**
- New/focused attention/status tests: **25 passed**
- Prompt-store tests: **15 passed**
- Full Desktop UI suite: **570 files / 5,468 tests passed**
- Targeted Bot Mode Python suite: **39 passed**
- Desktop typecheck: passed
- ESLint: **0 errors**; 117 pre-existing warnings
- Production Desktop build: passed; `assert-dist-built` passed
- `git diff --check`: passed
- Added-line security scan: no hardcoded-secret, shell-injection, eval/exec, unsafe-HTML, or SQL-format matches
- Independent fail-closed review: **PASS**

## Live current-source acceptance

An isolated X11 Desktop was launched without touching the canonical app:

```text
HERMES_HOME=/tmp/hermes-product-baseline-home
userData=/tmp/hermes-product-candidate-userdata
app name=Hermes Bot Mode Candidate
source=/home/decrux/Code/hermes-product-convergence
CDP=127.0.0.1:9334
```

Observed through CUA + CDP:

- current-source Desktop window launched on the same X11 session CUA captures;
- provider-later onboarding path worked without credentials;
- Bots pane and Cronjobs contextual pane rendered;
- New Agent dialog created `qa-bot` in the throwaway home;
- model/provider inheritance succeeded (`stealth/ox-alpha`);
- no credential was copied into the isolated home;
- first turn failed honestly with `Hermes is not logged into Nous Portal` rather than fabricating readiness.

This proves launch/setup/error behavior. It does **not** claim a live screenshot of a successful model turn or a real Needs-you prompt in the credential-free home.

Evidence screenshots (Hermes cache):

- baseline Bots pane: `/home/decrux/.hermes/cache/images/computer_use_b91ac7dc3fbc486c9ea9766a81fbebae.png`
- current-source candidate: `/home/decrux/.hermes/cache/images/computer_use_a2ceea14a397440ebdb46df6c67e698f.png`
- truthful no-auth failure: `/home/decrux/.hermes/cache/images/computer_use_5fe7140ecac847afbc4afc8390d4b146.png`

## Upstream delivery status

Prepared:

- PR body: `PR_BODY_BOT_MODE_ATTENTION.md`
- patch: `artifacts/0001-fix-desktop-surface-real-Bot-Mode-attention-states.patch`
- patch SHA-256: `559095adaddeb63922a323311a630a91868ac5474c5fbd0a14301d8d37ed12c3`

The branch is clean and based on current upstream main. Pushing to `DECRUX9812/hermes-agent` is blocked by the existing token missing GitHub's `workflow` scope:

```text
refusing to allow an OAuth App to create or update workflow
.github/workflows/ci-review-comment.yml without workflow scope
```

The fork is old enough to predate bundled Bot Mode, so rebasing onto the fork's main is not viable. A refreshed GitHub token with `repo` + `workflow`, or a one-time `gh auth login`, is required to publish the already-prepared PR.

## Ranked next slices

1. **Publish and land the attention/status PR** after GitHub scope authorization.
2. **Canonical lifecycle regressions:** reproduce and fix archived/retitled Bot Chat handling only on current main; never reintroduce a session-ID pin.
3. **Per-bot pause/mute:** only if implemented as shared server-backed state that gates current `message_agent` and group delivery. A plugin-only toggle would be fake and is rejected.
4. **Accessibility/i18n/performance:** reduce raw button/title drift, add explicit list semantics, move plugin copy toward the plugin i18n seam, and replace high-frequency polling only where gateway events can reconstruct state after reconnect.
5. **Project/workspace UX:** selectively adopt context labels and contextual drawers inside the current chat-first shell; no Workbench big-bang rewrite.

## Artifacts

```text
/home/decrux/Code/hermes-product-convergence/HARNESS_WAR_BRIEF.md
/home/decrux/Code/hermes-product-convergence/BOT_MODE_CONVERGENCE_REPORT.md
/home/decrux/Code/hermes-product-convergence/PR_BODY_BOT_MODE_ATTENTION.md
/home/decrux/Code/hermes-product-convergence/artifacts/0001-fix-desktop-surface-real-Bot-Mode-attention-states.patch
/home/decrux/Code/hermes-bot-attention-pr
```
