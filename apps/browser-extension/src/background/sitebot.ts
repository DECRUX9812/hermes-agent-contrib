/**
 * Site avatars — the "the page comes alive" layer.
 *
 * Every tab's host gets an embodiment: a synthetic Bot whose mascot lives
 * alongside the roster bots. Tasks to a site bot ride a real harness bot
 * (the first connected one) with the site's context injected, so a GitHub
 * repo or a YouTube page answers natural-language tasks as itself.
 *
 * The recipe table is the fun part — named personalities per domain, falling
 * back to the hostname itself ("the page is the bot").
 */

import type { Bot } from '../shared/types'

interface SiteRecipe {
  match: RegExp
  /** Avatar name (drives the mascot identity/face). */
  name: (u: URL) => string
  /** Display label shown in panels. */
  label: (u: URL) => string
  /** What kind of site this is, injected into the task context. */
  kind: string
}

const RECIPES: SiteRecipe[] = [
  {
    match: /^github\.com$/,
    name: (u) => {
      const parts = u.pathname.split('/').filter(Boolean)

      return parts.length >= 2 ? `Repo-${parts[1]}` : 'GitHub'
    },
    label: (u) => u.pathname.split('/').filter(Boolean).slice(0, 2).join('/') || 'github.com',
    kind: 'a GitHub repository',
  },
  {
    match: /^(www\.)?youtube\.com$/,
    name: () => 'Tube',
    label: () => 'YouTube',
    kind: 'YouTube (videos, search, comments)',
  },
  {
    match: /^(www\.)?(twitter\.com|x\.com)$/,
    name: () => 'Birdsite',
    label: () => 'X/Twitter',
    kind: 'X/Twitter (tweets, replies, timelines)',
  },
  {
    match: /^(www\.)?linkedin\.com$/,
    name: () => 'Linker',
    label: () => 'LinkedIn',
    kind: 'LinkedIn (profiles, posts, replies)',
  },
  {
    match: /^(www\.)?reddit\.com$/,
    name: () => 'Snoo',
    label: () => 'Reddit',
    kind: 'Reddit (threads, replies)',
  },
]

export function siteAvatarFor(
  url: string,
  pickRealBot: () => Bot | undefined,
): Bot | null {
  let u: URL

  try {
    u = new URL(url)
  } catch {
    return null
  }

  if (!u.hostname || u.protocol === 'chrome-extension:') {return null}
  const recipe = RECIPES.find((r) => r.match.test(u.hostname))
  const real = pickRealBot()

  if (!real) {return null}
  const host = u.hostname
  const name = recipe?.name(u) ?? hostTitleCase(host)
  const label = recipe?.label(u) ?? host
  const kind = recipe?.kind ?? 'a website'

  const bot: Bot = {
    id: `site:${host}`,
    harnessId: real.harnessId,
    name,
    displayName: `${name} · ${label}`,
    color: '#5470ff',
    status: 'idle',
    pageControl: real.pageControl,
    ref: real.ref,
    siteHost: host,
    siteLabel: `${label} — ${kind}`,
  }

  return bot
}

function hostTitleCase(host: string): string {
  const base = host.replace(/^www\./, '').split('.')[0] ?? host

  return base.charAt(0).toUpperCase() + base.slice(1)
}

/** Context prefix injected into tasks sent to a site avatar. */
export function sitePromptPrefix(bot: Bot, url: string, title: string): string {
  return (
    `[You are "${bot.displayName}", the living avatar of ${bot.siteLabel} at ${url} ("${title}"). ` +
    'The user is browsing you right now — act as the site itself: navigate it, read it, ' +
    'edit its composer fields, open overlay windows. Be the page, in character, concise.]\n\n'
  )
}
