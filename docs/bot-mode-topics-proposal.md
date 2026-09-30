# Proposal: Bot Mode topics, orchestrator-only team chats, and setup simplification

Status: proposal for maintainer review. Companion digest: `bot-mode-feedback-digest.md`.
Prepared on the community fork `DECRUX9812/hermes-agent-contrib`; PRs referenced are on that fork's `main`.

## What changed vs. the "one Bot Chat per bot" rule — and what did not

The standing rule (**one bot = one canonical forever-chat, identified by (profile, "Bot Chat") title**) is preserved in full. No stored session-id pointer was added, recency still never decides the row's target, and canonical chats stay hidden.

What topics change is *surface*, not *identity*: a bot may now have many **topics** (side chats) that share its *powers* but never its *identity*. Concretely:

- A new `bot_topic` marker is set once at session creation (desktop mints it for chats started from the bots workspace), recorded on the session's `model_config`, and restored on every resume path.
- The three bot-power gates (`message_agent`, `update_task`, the "Messaging other agents" prompt section) now read `bot_powered_session(agent)` — canonical chat **or** `bot_topic` — instead of title alone. The marker is fixed for the session's life, so the tool list and system prompt stay byte-identical across turns (prompt-cache invariant holds).
- Canonical identity remains `(profile, title)` exactly: `canonical_bot_chat(agent)` still keys on the title hint only, and only the canonical chat is hidden/inbox/preview. A topic is *powered*, never *canonical*.

Why this shape: it is the minimum delta that fixes the top complaint ("a fresh chat loses my bot") while leaving the identity invariant — which five hardening waves established — untouched.

## Shipped on the fork (reviewable as PRs)

| PR | Scope |
|----|-------|
| #120 | `bot_topic` marker end-to-end: session.create param → model_config → all resume paths → single probe gate. Desktop mints it for bots-workspace chats. Real-`HERMES_HOME` E2E + unit invariants. |
| #121 | Long-context nudge: dismissible "start a topic" card on a bloated canonical chat (60+ msgs or 150k+ input tokens), per-bot persisted dismissal with 1.5× regrowth re-show. |
| (children) | Orchestrator-only team chats; bot-pane UX ("New topic" primary action, pinned inbox, bot card model/skills/teammates, "How bots work" explainer); impersonation + turn-cap guardrails; create-bot button + starter bots. Links land as each PR opens. |

## Recommendations for upstream, by feedback theme

Ordered by the maintainer tracker's own classes (umbrella #94726) intersected with community volume:

1. **Delivery while the canonical chat is open** — Bot Mode DMs silently die against a live Desktop owner (#95074 two-reply-paths; fixed shape in PR #100544: durable pending→claimed handoff polled by the live owner at turn boundaries). Recommend adopting the handoff mechanism; it is the single most damaging "the bot ignored me" failure.
2. **Group-chat engine** — @mention continuation never schedules the cited member (#94478), sentinels render (#94308/#94376), no cancel (#91868/#94569), poll-driven turns (#92760: 2s `session.resume` polling → replace with push/delta). Turn caps: PR #98047's `config.yaml group_chat` block (clamped) is the right shape; ship it plus a room-settings surface so users discover it.
3. **Session routing/transcript staleness** (#3 cluster — largest by volume): one control-plane audit of open→resolve→hydrate→append, every read/write carrying the owning profile.
4. **Topics (this proposal)** — powers without identity, per above.
5. **Onboarding simplification** — create-bot button already exists in the editor; the gap is *starter bots* (a couple of bundled general-purpose profiles at first launch) and an "extra simple" mode that hides profiles/groups behind a single roster. Both are desktop-plugin scope, not core.
6. **Remote/multi-connection** — connection-scoped routing audit (#4 cluster); remote bots are second-class today.

## Explicitly NOT proposed

- Multiple listeners per room turn (the "5× tokens" complaint) — orchestrator-only reading is the fix, not parallel fans.
- Any session-id pointer, recency, or visibility heuristic for canonical identity — the rule stands.
- Core-surface additions: everything above is plugin/gateway layer.
