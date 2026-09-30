---
title: "Bot Team Builder — Create Bot Mode bots and a team for the user"
sidebar_label: "Bot Team Builder"
description: "Create Bot Mode bots and a team for the user"
---

{/* This page is auto-generated from the skill's SKILL.md by website/scripts/generate-skill-docs.py. Edit the source SKILL.md, not this page. */}

# Bot Team Builder

Create Bot Mode bots and a team for the user.

## Skill metadata

| | |
|---|---|
| Source | Bundled (installed by default) |
| Path | `skills/autonomous-ai-agents/bot-team-builder` |
| Version | `1.0.0` |
| Author | Ritesh Patel (@DECRUX9812), Hermes Agent |
| License | MIT |
| Platforms | linux, macos, windows |
| Tags | `Bot-Mode`, `Bots`, `Teams`, `Onboarding`, `Delegation` |
| Related skills | [`hermes-agent`](../../bundled/autonomous-ai-agents/autonomous-ai-agents-hermes-agent.md) |

## Reference: full SKILL.md

:::info
The following is the complete skill definition that Hermes loads when this skill is triggered. This is what the agent sees as instructions when the skill is active.
:::

# Bot Team Builder Skill

Sets up Bot Mode for the user: creates bots (each is a profile the Desktop Bots pane shows) and
organizes them into a team with one lead, all through `hermes bots` in the `terminal`. Use it
when the user wants helpers but shouldn't have to learn profiles, SOUL files or org charts. It
does not change models, keys or skills beyond what the new bots clone from the active profile.

## When to Use

- The user asks for a bot, several bots, "a team", "assistants for X", or "set up bot mode".
- The user keeps doing distinct kinds of work in one chat (research, coding, ops, writing):
  **propose** a team — never create bots unasked.
- A group chat wakes every bot and the user complains about noise or token cost: a team with a
  lead fixes it (only the lead listens; teammates wake on @mention or delegation).

## Prerequisites

- `hermes bots` available (this install). Check with `terminal`: `hermes bots list`.
- The active profile has a working model: new bots clone its config and keys.

## How to Run

Everything goes through `terminal`. Add `--json` for machine-readable output.

```
hermes bots list
hermes bots create <name> --title <Display> --role "<one-line role>" --persona "<how it behaves>" --color "#35d49a"
hermes bots team create <Team> --mission "<what the team is for>"
hermes bots team add <Team> <name> --lead --title "<seat title>"
hermes bots team add <Team> <name> --reports-to <lead-name>
hermes bots team show <Team>
```

## Quick Reference

| Starter | Name | Role | Good persona line |
|---|---|---|---|
| Researcher | `scout` | Finds and cites sources | Cite every claim; say when unsure. |
| Coder | `forge` | Writes and reviews code | Small diffs, runs tests before claiming done. |
| Ops | `pilot` | Runs checks, schedules, deploys | Confirm before anything irreversible. |
| Writer | `quill` | Drafts and edits prose | Plain words; match the user's voice. |

Names are lowercase profile names (letters, digits, `-`, `_`). Titles are what the user sees.

## Procedure

1. **Understand the work.** If the request is vague, look at what the user actually does: use
   `session_search` for recent topics (for example "research", "deploy", "bug", "draft") and
   group them into 2–4 kinds of work. One bot per kind; more than four is noise.
2. **Propose before creating.** Tell the user the plan in one short list: each bot's title, one
   line of role, and who leads. Ask for a yes or edits. Skip this only when the user already
   named the bots they want.
3. **Check what exists:** `hermes bots list --json`. Reuse existing bots; never create a
   duplicate name.
4. **Create each bot** with `hermes bots create`. Keep `--persona` to 1–2 sentences of
   behavior, not a biography. Give each bot a distinct `--color` so the roster and a group
   room tell the voices apart at a glance.
5. **Make the team:** `hermes bots team create`, then seat the lead first with `--lead`, then the
   rest with `--reports-to <lead>`. The lead should be the generalist the user will talk to.
6. **Tell the user how to use it** in three lines: open the Bots pane; talk to the lead (it
   delegates); @mention a teammate to pull them in directly. Mention "New topic" starts a fresh
   chat with the same bot when context gets long.

## Pitfalls

- Do not create bots the user didn't agree to — propose first (step 2).
- A team needs exactly one lead; without one, group chats fall back to every bot listening.
- Bots clone the active profile. If the user wants a different model for one bot, point them
  to the bot's settings in the Bots pane rather than editing config files.
- `hermes bots team add` refuses profiles that aren't bots; create the bot first.

## Verification

- `hermes bots list` shows every new bot with its title.
- `hermes bots team show <Team>` shows the lead marked `[lead]` and every seat filled.
