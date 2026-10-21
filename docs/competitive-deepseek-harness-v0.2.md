# DeepSeek Harness v0.2 (desktop preview) vs Hermes

**Source:** the @DeepSeekHarness launch article and its replies, Sep 30, 2026. **Purpose:** find
real gaps to lift, and the story we tell next to it.

## Their v0.2 features, mapped to shipped Hermes

| DeepSeek Harness v0.2 | Hermes today | Where |
|---|---|---|
| Desktop app (macOS, Windows) | Desktop on macOS, Windows **and Linux**, plus CLI, **TUI**, and ~20 chat apps through the gateway | `apps/desktop/`, `ui-tui/`, `gateway/platforms/` |
| Files, previews and code changes in the conversation; right sidebar to preview and review | Right sidebar with files, review (diffs), artifacts, live and terminal panes; "N files changed → Review" card per turn | `apps/desktop/src/app/right-sidebar/` |
| Scheduled tasks ("Automation Task" plugin) with run history, frequency and instructions | Cron jobs with a master/detail view, run history, blueprints and delivery targets; `hermes cron` CLI | `cron/`, `apps/desktop/src/app/cron/` |
| Choose how much detail agent steps show | Appearance → tool view density, and hide code diffs; the CLI/TUI has `tool_progress` modes and `/focus` | `store/tool-view.ts`, `display.*` config |
| "Everything is a plugin" | Python plugins, portable Agent Plugins v1, desktop plugins (panes, status bar, palette, routes, themes), MCP servers, skills | `plugins/`, `apps/desktop/src/contrib/` |
| Plugin manager: install by name, disable, uninstall, see source | Capabilities → Plugins tab plus install modal; `hermes plugins install/search/browse/update/check-updates/enable/disable/remove`, provenance tracking, a curated catalog with a pinned-SHA review gate | `app/capabilities/plugins/`, `hermes_cli/plugins*.py` |
| **Creator mode:** describe a plugin and it's built and loaded live | Already the design: the agent writes `$HERMES_HOME/desktop-plugins/<id>/plugin.js`, and the app hot-loads it with no reload step; the bundled `hermes-agent` skill carries the reference and template | `contrib/runtime-loader.ts`, `skills/autonomous-ai-agents/hermes-agent/references/desktop-plugins.md` |

## Their roadmap is our shipped list

- **Agent teams:** Bot Mode. The main bot hires a crew (`hermes bots create/team`); a team room
  listens through its lead only; delegation and topics.
- **Long-term memory:** memory providers plus skills that the agent writes as it learns.
- **Browser and GUI automation:** browser tools with real-profile browsing, and computer use.
- **Remote and mobile access:** the messaging gateway (Telegram, WhatsApp, Signal, Slack,
  Discord, …) and remote backends.
- **Official plugin marketplace:** the curated plugin catalog plus the skills registries.

## What their replies ask for (and we have)

The loudest replies on the launch are "no Linux build?", "any plans for a TUI?", and "make the
desktop app open source". Hermes ships all three. That is the headline for any side-by-side.

## What we lift

1. **The showpiece demo.** "Build me a plugin in real time" is their launch clip. We can already do
   it, and it should be in our demo: the agent writes a Launch countdown plugin and the app
   hot-loads it on camera.
2. **Say "everything is a plugin" plainly.** Our plugin surface is wider (desktop, Python, MCP,
   skills) but it's described in four places. One user-facing page that tells the whole story is a
   docs task, not a code task.
3. **Newcomer-visible plugin creation.** Theirs is a labeled "creator mode". Ours works when you
   ask, but nothing in the UI suggests it. Candidate: a "Build a plugin…" entry in Capabilities →
   Plugins that opens a chat seeded with the plugin skill. Small, and no new core surface.
