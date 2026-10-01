# The last mile is the user's: interop without anyone's permission

**Status:** position + map of shipped pieces + next steps. Sep 30, 2026.

## The argument we're answering

The dream of the interoperable web is simple: if apps published APIs in a standard shape, any
client could talk to any service. Email (the one daily system that works this way) shows the payoff:
any client, any server, you can reach anyone whatever choices they made. The payoff for
everything else would be embedding posts from anywhere, alternate clients for big networks, and
actions triggered on one platform from another.

It has failed twice, for two reasons:

1. **Technical.** Modelling every case in a standard is impossible. The semantic web and smart
   contracts both hit this. **LLMs mostly dissolve it**: a model can figure out how to call a
   system without an exhaustive spec.
2. **Economic, and this one stands.** Platforms won't give up the last mile. A delivery app's
   checkout is tuned to make you spend more, so why would it publish an MCP server that hands
   that flow to someone else? It only happens under overwhelming demand (the mobile-app moment).
   Even then it tends to be one-off deals with the biggest assistants. The economics pull toward
   walled gardens.

## Hermes's answer: stop waiting for the server side

Email interop never needed Gmail's permission to exist as a client. A **user agent** (the
browser, the mail client) acts for its user, in the user's own session. The last mile the
platform built is still the one that runs, but the person drives it through a client they chose.

Hermes is a user agent with a model inside. So interop doesn't depend on a platform publishing
anything:

| What the dream wanted | How Hermes does it today (shipped) |
|---|---|
| Call any system | **Real profile browsing** (`browser.md` → "Real profile browsing"). The agent browses *as you*, with your existing logins, through the platform's own UI. No API needed. Where an API or MCP server *does* exist, the built-in MCP client uses it. |
| Embed posts/views from other sites | **MCP Apps host** (`docs/desktop-mcp-apps-host-proposal.md`). Any server's UI renders inline, sandboxed. **Desktop plugins**: the agent writes a pane that hot-loads, so the view is yours. |
| Alternate clients to popular networks | The agent builds *your* client: a plugin pane or an MCP App fed by what it reads in your session. Same data, your layout, no feed optimizer. |
| Trigger actions on one platform from anywhere | Reach Hermes from ~20 chat apps, cron, and webhooks. The agent then acts wherever you're logged in. Approvals gate dangerous commands today, and the browser's irreversible steps are next (below). |
| A shared standard | **Skills.** The first time the agent works out a site, it writes the procedure down (`skill_manage`). `hermes skills publish` / `install` share it. **The adapter a platform won't publish gets written by its users, one skill at a time**, and improves each time someone uses it. |

The economic point flips. Platforms can decline to publish an API, but they can't decline to be
used by their own logged-in users, which is the same position every browser and mail client has
always had.

## Lines we hold

- **Only as the user, only for the user.** The agent uses the session the user already has. It
  never harvests credentials, never runs accounts the user doesn't own, and never scrapes at
  scale.
- **The platform's rules still apply.** The terms of service, rate limits and robots rules hold
  for the agent exactly as for the person. An adapter skill that needs to break them doesn't get
  published.
- **The user owns the irreversible step.** Purchases, posts, messages and deletions must go through
  approval (or the user's explicit standing rule). This is the whole difference from the
  platform's optimized funnel: the user can see and decide. Today approval covers dangerous
  commands; extending it to browser actions is next step 1.
- **Prompt caching and the narrow core still hold.** None of this adds a core tool. It is
  browser + file + skills + plugins, which are rungs 1–4 of the footprint ladder.

## Next steps (not shipped)

1. **Approval on irreversible browser actions.** A pay, post, send or delete click through the
   browser tools asks first, the same approval surface commands already use.
2. **`site-client` skill.** Turn any site into a personal client pane:
   - read through real-profile browsing;
   - render as a desktop plugin or MCP App;
   - send every action back through the agent, gated by approval.

   It's a skill plus the existing plugin template, with no new core surface.
3. **Adapter skills as a category** in the skills registry (`web-adapters/<site>`), with a
   freshness check: an adapter re-verifies its flow and flags itself when the site changes.
4. **"Works without an API" badge** in the plugin/skill catalog for adapters built this way, so
   users can see which integrations don't depend on the platform's goodwill.
