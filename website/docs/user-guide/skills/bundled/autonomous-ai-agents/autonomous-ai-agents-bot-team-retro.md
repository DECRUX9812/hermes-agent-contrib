---
title: "Bot Team Retro — Run a short retro so the user's bots learn lessons"
sidebar_label: "Bot Team Retro"
description: "Run a short retro so the user's bots learn lessons"
---

{/* This page is auto-generated from the skill's SKILL.md by website/scripts/generate-skill-docs.py. Edit the source SKILL.md, not this page. */}

# Bot Team Retro

Run a short retro so the user's bots learn lessons.

## Skill metadata

| | |
|---|---|
| Source | Bundled (installed by default) |
| Path | `skills/autonomous-ai-agents/bot-team-retro` |
| Version | `1.0.0` |
| Author | Ritesh Patel (@DECRUX9812), Hermes Agent |
| License | MIT |
| Platforms | linux, macos, windows |
| Tags | `Bot-Mode`, `Bots`, `Teams`, `Learning`, `Memory` |
| Related skills | [`bot-team-builder`](../../bundled/autonomous-ai-agents/autonomous-ai-agents-bot-team-builder.md), [`hermes-agent`](../../bundled/autonomous-ai-agents/autonomous-ai-agents-hermes-agent.md) |

## Reference: full SKILL.md

:::info
The following is the complete skill definition that Hermes loads when this skill is triggered. This is what the agent sees as instructions when the skill is active.
:::

# Bot Team Retro Skill

Helps the user's bots get better at their jobs: you read what each bot recently did, propose a
few concrete lessons, and write only the ones the user approves into that bot's memory with
`hermes bots lesson`. It is one pass, with the user as the decision-maker. It does not create
rules, councils or review chains, and a lesson never outranks what the user says in the moment.

## When to Use

- The user asks how their bots could do better, asks for a "retro", "lessons learned" or
  "teach my team", or wants the team to follow a standard ("always cite sources").
- A bot repeated a mistake the user corrected before: offer a lesson so it sticks.
- The user tells a lead how their department should work (for example "Forge, every change
  ships with a test"): write it as a lesson on the bots it covers.

## Prerequisites

- Bot Mode bots exist: `terminal` → `hermes bots list`. If there are none, use the
  `bot-team-builder` skill first.
- Lessons live in each bot's own `MEMORY.md`, which has a size cap (about 2,200 characters,
  shared with the bot's own notes). Keep each lesson to one sentence.

## How to Run

```
hermes bots list
hermes bots team show <Team>
hermes -p <bot> sessions list --limit 5
hermes -p <bot> sessions export --format md --newer-than 7d <dir>
hermes bots lesson add <bot> "<one-sentence lesson>"
hermes bots lesson add --team <Team> "<lesson for every bot on the team>"
hermes bots lesson list <bot>            # or: --team <Team>
hermes bots lesson remove <bot> <number>
```

## Quick Reference

| Good lesson | Why it works |
|---|---|
| Run the tests before saying a change is done. | One action, checkable, came from a real miss. |
| Cite a source for every number in a report. | Specific to the bot's job. |
| Ask before deleting files outside the project. | Protects the user without blocking work. |

| Not a lesson | Why not |
|---|---|
| "All work must be reviewed by the lead first." | Red tape: slows every task to fix a rare one. |
| "Never change the plan without a team vote." | Lets bots overrule the user. |
| "Be more careful." | Not an action anyone can check. |

## Procedure

1. **Scope it.** Ask which bots or team the retro covers, unless the user already said. Default
   to the last 7 days.
2. **Read the work.** For each bot, list its recent sessions and export the ones that matter with
   `terminal`, then read them with `read_file`. Look for repeated corrections from the user,
   tasks that failed or had to be redone, and things the user praised.
3. **Propose, don't decide.** Show the user at most 5 lessons in total, numbered, each with the bot
   it is for and one line of evidence ("Forge said 'done' twice before tests ran"). Ask which to
   keep, edit or drop. Write nothing until the user answers.
4. **Write only what was approved,** exactly as approved: `hermes bots lesson add <bot> "..."`, or
   `--team <Team>` when the user wants it on every bot. If a bot's memory is full, show the
   user `hermes bots lesson list <bot>` and ask which old lesson to remove first.
5. **Close in two lines:** what was added to whom, and that it applies from each bot's next chat.
   Remind the user that `hermes bots lesson remove <bot> <number>` takes any of them back.

## Pitfalls

- **Never write a lesson the user did not approve.** Not even an obvious one.
- **No process lessons.** Lessons that add approvals, votes, audits or review steps make bots slow
  and can lock the user out of their own team. If the user asks for one, write the smallest version
  and say what it will cost.
- **No reviews of reviews.** One retro is one pass. Do not schedule a retro of the retro or ask
  bots to audit each other.
- **The user's word wins.** If a lesson conflicts with what the user asks now, follow the user and
  offer to remove or edit the lesson.
- Do not copy private details from transcripts into lessons; write the behavior, not the data.

## Verification

- `hermes bots lesson list <bot>` shows each approved lesson and nothing else new.
- The next chat with that bot follows the lesson without being reminded.
