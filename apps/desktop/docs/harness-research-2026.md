# Harness research — what the best coding and personal agents do (Sep 2026)

Input to [`revamp-plan.md`](./revamp-plan.md) §3.4. It extends the product
survey in [`agentic-desktop-roadmap.md`](./agentic-desktop-roadmap.md) §1 (OS3,
OpenClaw, AionUi, Cursor 2, Windsurf/Devin, Zed, Claude Code Desktop, ChatGPT,
Warp, Raycast, Muse, Grok Bot) with the harnesses that moved since. Findings
come from public product pages, docs and reviews as of 2026-09-26. The
*pattern* is what we adopt, never the pixel.

## 1. Coding harnesses

| Product | What it does best | Pattern for Hermes |
|---|---|---|
| **OpenAI Codex app** (macOS Feb, Windows Mar 2026) | Manages many agents at once. Built-in worktrees, **Skills**, **Automations** (scheduled tasks running in their own worktree), and a **review queue** of finished work. | Finished runs land in a *review queue*, not a pile of tabs. Scheduled work gets isolation by default. |
| **Cursor 3** (Agents Window, Apr 2026) | Agent-first full-screen window. Parallel agents across local, worktree, cloud and SSH, with local↔cloud handoff. `/multitask` spawns async subagents. **Design Mode** annotates UI elements in the browser. | One window for every agent regardless of *where* it runs. Point-at-the-UI feedback. |
| **Google Antigravity 2.0** (May 2026) | Editor view + **Agent Manager**. Up to 5 agents; one **Inbox** of every pending approval across projects. **Artifacts** — plans, task lists, screenshots, browser recordings — as reviewable *receipts* instead of raw logs. | Every run produces **receipts**. Approvals aggregate into one inbox. |
| **Conductor** (Mac) | Parallel Claude Code / Codex / Cursor agents in worktrees, side-by-side progress, **review → PR → merge** in-app. **Start from a Linear issue**: workspace, branch and prompt are created for you. | Start work *from the thing that asked for it* (issue, message, file). Merge-back is part of the flow. |
| **Amp** | Shareable threads (messages + tool calls + diffs). **Handoff instead of compaction**: an editable summary seeds a *fresh* thread rather than lossy compression. Shared runners. | "Continue in a fresh session" with an editable brief — cache-clean by construction. |
| **OpenCode desktop** (open source) | Native, themeable, 75+ providers, LSP auto-loaded, session share links, i18n + RTL, **markdown parsing moved off the main thread** for responsiveness. | Provider freedom as a feature. Keep rendering off the main thread. |
| **Goose** (Block → Linux Foundation) | Desktop + CLI. **Recipes**: version-controlled YAML workflows teams commit and share. Built-in memory/subagent/computer-control extensions + 70 MCP. | Repeatable workflows as shareable, versioned objects (≈ our skills + cron blueprints). |

## 2. Personal harnesses

| Product | What it does best | Pattern for Hermes |
|---|---|---|
| **Claude Cowork** (Desktop GA Apr 2026) | Agentic tasks over files and connectors. **Scheduled/recurring tasks** (`/schedule`) that run in the cloud with the laptop closed. Plugins shared across chat/Code/Cowork. | Scheduling from inside any task. The same plugins everywhere. |
| **Poke** (Mar 2026; Cognition since Jul) | An agent you **text** (iMessage, WhatsApp, SMS, Telegram). **Proactive**: watches connected accounts and surfaces actionable prompts (check-ins, conflicts). | Messaging *is* the interface; the desktop is its control tower. Opt-in proactivity from connected sources. |
| **Manus "My Computer"** (Mar 2026) | Local file/app/terminal control, with every command gated by **Allow once / Always allow**. Continues tasks across devices. | Legible, granular permission tiers. Cross-device continuity. |
| **ChatGPT Pulse → scheduled tasks** | Nightly async research turned into morning cards. Pulse was *sunset Jun 2026*, folded into scheduled tasks. | The daily brief is a **scheduled task**, not a bespoke feed. Build it on cron, not a new surface. |
| **OpenClaw** (Control UI, Sep 2026) | Browser workspace for conversations and parallel work: pin/group sessions, SKILL.md skills + ClawHub, **heartbeat** (wakes on an interval against `HEARTBEAT.md`), **Canvas** (agent-built dashboards), mobile canvas. | Heartbeat = periodic self-check (≈ cron + nudges). Agent-made visual surfaces (≈ artifacts). |
| Muse, Grok Bot, rabbitOS 3 | See `revamp-plan.md` §3. | Teammates, outcomes, report-back. |

## 3. Synthesis

### 3.1 Table stakes — a 2026 harness without these feels old

| Capability | Leaders | Hermes today |
|---|---|---|
| Parallel agents, isolated worktrees | Codex, Cursor, Conductor | ✅ fan-out + worktree-per-session (opt-in) |
| One approval inbox | Antigravity, AionUi | ⚠️ exists, split across 7 surfaces → Mission Control |
| Review queue → merge/PR | Codex, Conductor | ⚠️ review pane + merge-back, no queue |
| Receipts (plan, tasks, screenshots, recordings) | Antigravity | ⚠️ artifacts + report cards, not unified per run |
| Scheduled work | Codex, Cowork, ChatGPT | ✅ cron + blueprints (not offered in context) |
| Skills / recipes | Codex, Goose, OpenClaw | ✅ skills (+ Hermes writes its own — see 3.2) |
| Point-at-UI feedback | Cursor Design Mode | ✅ preview annotate, region capture |
| Local ↔ remote ↔ cloud | Cursor, Manus | ✅ connections, handoff links; cutover improves it |
| Fresh-context handoff | Amp | ❌ compression only |
| Share a run | Amp, OpenCode | ⚠️ transcript export only |
| Granular permission tiers | Manus, Claude | ⚠️ approval modes exist; tiers not legible on the card |
| Responsive rendering | OpenCode | ❓ unmeasured (Wave 0.2) |

### 3.2 Hermes's unfair advantages — lean in, nobody else has the set

1. **It learns.** Memory + self-authored skills + the curator
   (`agent/curator.py`: auto-maintains skills, never deletes, pinned skills are
   untouchable, runs on the auxiliary client off the main prompt cache) +
   insights (`agent/insights.py`). Codex/Goose/OpenClaw have *skills you
   write*; Hermes *writes and maintains its own*. **In the desktop this is
   invisible**: memory appears only as provider config in Settings, and the
   curator only in Command Center → Maintenance.
2. **It's everywhere.** ~20 messaging platforms via the gateway, plus mobile
   companion. Poke built a company on "text your agent". Hermes already *is*
   that agent, and the desktop should be its control tower.
3. **Any model.** Any provider, local models, fallbacks, free tier. Codex,
   Antigravity and Cursor are vendor-anchored.
4. **Coding *and* life in one agent.** Real terminal backends (local,
   docker, ssh, modal), browser, cron, kanban, bots-as-profiles. Coding
   harnesses stop at the repo; personal ones stop at the inbox.
5. **Open.** Plugins, MCP, skills hub, profiles. No lock-in.

### 3.3 The positioning

> **The one agent you text, code with, and delegate to, which gets better
> every week, on any model. The desktop is where you watch it work, review
> what it did, and see what it learned.**

Beat the coding harnesses on *breadth + learning*; beat the personal
harnesses on *real execution + oversight*. Match table stakes; win on 3.2.

## Sources

- Codex app: [OpenAI — Introducing the Codex app](https://openai.com/index/introducing-the-codex-app/), [Codex scheduled tasks](https://developers.openai.com/codex/app/automations), [IntuitionLabs guide](https://intuitionlabs.ai/articles/openai-codex-app-ai-coding-agents)
- Cursor 3: [Agents Window docs](https://cursor.com/docs/agent/agents-window), [Meet the new Cursor](https://cursor.com/blog/cursor-3), [Cursor 3 guide](https://www.digitalapplied.com/blog/cursor-3-agents-window-complete-guide)
- Antigravity: [Google Developers Blog](https://developers.googleblog.com/build-with-google-antigravity-our-new-agentic-development-platform/), [Artifacts docs](https://antigravity.google/docs/artifacts/), [Agent Manager guide](https://www.aifire.co/p/mastering-the-antigravity-agent-manager-2026-guide-part-1)
- Conductor: [CodePick intro](https://codepick.dev/en/guides/conductor-build-intro/), [What is Conductor](https://continuumcode.ai/guides/what-is-conductor/)
- Amp: [Handoff (No More Compaction)](https://ampcode.com/news/handoff), [release notes](https://releasebot.io/updates/ampcode)
- OpenCode: [release notes](https://releasebot.io/updates/sst/opencode), [developer guide](https://www.developersdigest.tech/blog/opencode-developer-guide-2026)
- Goose: [Deep-dive review](https://academy.kspl.tech/blog/ai-tool-deep-dive-goose), [The Agent Report](https://the-agent-report.com/2026/05/block-goose-ai-agent-recipe-runner-scaled-60-percent/)
- Claude Cowork: [Schedule recurring tasks](https://support.claude.com/en/articles/13854387-schedule-recurring-tasks-in-claude-cowork), [Get started with Cowork](https://support.claude.com/en/articles/13345190-get-started-with-claude-cowork)
- Poke: [TechCrunch](https://techcrunch.com/2026/04/08/poke-makes-ai-agents-as-easy-as-sending-a-text/), [AppleInsider](https://appleinsider.com/articles/26/06/04/first-ai-agent-for-messages-business-chat-approved-by-apple), [Agent Index](https://theaiagentindex.com/agents/poke)
- Manus: [Introducing My Computer](https://manus.im/blog/manus-my-computer-desktop), [CNBC](https://www.cnbc.com/2026/03/18/metas-manus-launches-desktop-app-to-bring-its-ai-agent-onto-personal-devices.html), [AgentMarketCap](https://agentmarketcap.ai/blog/2026/04/15/manus-my-computer-desktop-agent-meta-local-ai)
- ChatGPT Pulse: [OpenAI — Introducing Pulse](https://openai.com/index/introducing-chatgpt-pulse/), [Pulse retired](https://justinmckelvey.com/blog/chatgpt-pulse)
- OpenClaw: [v2026.7.1 release](https://docs.openclaw.ai/releases/2026.7.1), [changelog Sep 2026](https://www.gradually.ai/en/changelogs/openclaw/), [Control UI & Canvas guide](https://www.ququ123.top/en/2026/02/openclaw-web-ui/)
