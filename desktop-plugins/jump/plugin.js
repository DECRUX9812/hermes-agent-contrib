/**
 * Jump — a keyboard-driven launcher for what the core palette under-serves.
 *
 * Why this exists, concretely: core ⌘K ranks rows with AND-substring matching
 * (`scoreItem` in app/command-palette/rank.ts), so "hwj" never finds
 * "hermes-webapp junit", and it contributes no per-skill / per-cron /
 * per-toolset rows at all. This plugin adds:
 *
 *   1. `/jump` — a launcher with real subsequence fuzzy matching (word-boundary,
 *      camelCase and streak bonuses) over chats, skills, toolsets, scheduled
 *      jobs and profiles, with its own keyboard model.
 *   2. A PALETTE_AREA contribution whose `items()` injects the same rows INTO
 *      core ⌘K. `items()` is re-read on every palette mount, which is the
 *      documented contract for dynamic membership.
 *   3. A rebindable keybind (default mod+shift+j) that opens the launcher.
 *
 * Data doors (verified against the app source, all read-only except the two
 * toggles a row explicitly names):
 *   chats    host.request('session.list', { limit }) → { sessions: [...] }
 *   skills   host.skills.list()      → [{ name, description, enabled, … }]
 *   toolsets host.toolsets.list()    → [{ name, label, enabled, … }]
 *   profiles host.profiles.list()    → [{ name, display_name, is_default, … }]
 *   cron     host.state.cronJobs     → readonly atom, no RPC needed
 *
 * There is deliberately NO full-text history search here. `/api/sessions/search`
 * is a REST route, and a plugin's only REST door (`ctx.rest`) is scoped to
 * `/api/plugins/<id>`, so message-body search is unreachable from a plugin that
 * ships no backend. A dead row would be worse than an absent one.
 *
 * Plain ESM, loaded uncompiled — UI is jsx() calls, not JSX syntax. The only
 * specifiers that resolve are @hermes/plugin-sdk, react, react/jsx-runtime.
 */

import {
	Badge,
	cn,
	Codicon,
	EmptyState,
	GlyphSpinner,
	host,
	KEYBINDS_AREA,
	PALETTE_AREA,
	PANES_AREA,
	ROUTES_AREA,
	SearchField,
	Separator,
	SIDEBAR_NAV_AREA,
	usePluginI18n,
	useQuery,
	useValue
} from '@hermes/plugin-sdk'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { jsx, jsxs } from 'react/jsx-runtime'

const ID = 'jump'
const ROUTE = '/jump'

// ── fuzzy matching ──────────────────────────────────────────────────────────
//
// Pure and exported so tests/fuzzy.test.mjs can exercise it in a bare node vm —
// no React, no SDK, no app. Everything below this line is deliberately free of
// side effects for that reason.

const SEPARATORS = new Set([' ', '-', '_', '/', '.', ':', '\\', '(', ')', '[', ']', '#', '@'])

/** True when `text[index]` starts a word: after a separator, or on a camelCase hump. */
const isBoundary = (text, index) => {
	if (index <= 0) {
		return true
	}

	const prev = text[index - 1]

	if (SEPARATORS.has(prev)) {
		return true
	}

	const cur = text[index]
	const prevLower = prev === prev.toLowerCase()
	const prevUpper = prev === prev.toUpperCase()

	return cur === cur.toUpperCase() && cur !== cur.toLowerCase() && prevLower && !prevUpper
}

/**
 * Score `needle` against `haystack`. 0 means no match; higher is better.
 *
 * Subsequence rather than substring: every needle char must appear in order,
 * but not necessarily adjacently. A contiguous hit always outranks a scattered
 * one, then word-boundary hits, consecutive runs and earlier first hits break
 * the remaining ties.
 */
export const fuzzyScore = (needle, haystack) => {
	const n = String(needle ?? '')
		.toLowerCase()
		.trim()

	if (!n) {
		return 1
	}

	const hay = String(haystack ?? '')

	if (!hay) {
		return 0
	}

	const hayLower = hay.toLowerCase()
	const direct = hayLower.indexOf(n)

	if (direct === 0) {
		return 1000 - Math.min(hay.length, 500)
	}

	if (direct > 0) {
		return 700 - direct - Math.min(hay.length, 200) * 0.5
	}

	let cursor = 0
	let score = 0
	let streak = 0

	for (let i = 0; i < n.length; i++) {
		const ch = n[i]

		if (ch === ' ') {
			continue
		}

		const at = hayLower.indexOf(ch, cursor)

		if (at === -1) {
			return 0
		}

		if (at === cursor && cursor > 0) {
			streak++
			// A run compounds — the longer the contiguous stretch, the better.
			score += 14 + streak * 6
		} else {
			streak = 0
			score += 3
		}

		if (isBoundary(hay, at)) {
			score += 13
		}

		cursor = at + 1
	}

	// Prefer the tightest haystack when everything else ties.
	return score - hay.length * 0.05
}

/**
 * Rank `items` against `query`. Each item supplies `label`, an optional
 * `keywords` haystack folded in at a discount, and an optional `weight` that
 * scales its score (a title hit should outrank a buried description hit).
 */
export const fuzzyRank = (items, query, limit = 60) => {
	const list = Array.isArray(items) ? items : []
	const q = String(query ?? '').trim()

	if (!q) {
		return list.slice(0, limit)
	}

	const scored = []

	for (const item of list) {
		const labelScore = fuzzyScore(q, item.label)
		const metaScore = item.keywords ? fuzzyScore(q, item.keywords) * 0.55 : 0
		const best = Math.max(labelScore, metaScore)

		if (best > 0) {
			scored.push({ item, score: best * (item.weight ?? 1) })
		}
	}

	scored.sort((a, b) => b.score - a.score)

	return scored.slice(0, limit).map(entry => entry.item)
}

const GROUPS = [
	{ id: 'session', icon: 'comment', label: 'Chats' },
	{ id: 'skill', icon: 'sparkle', label: 'Skills' },
	{ id: 'toolset', icon: 'tools', label: 'Toolsets' },
	{ id: 'cron', icon: 'calendar', label: 'Scheduled' },
	{ id: 'profile', icon: 'organization', label: 'Profiles' }
]

const groupOf = id => GROUPS.find(group => group.id === id)

// ── data ────────────────────────────────────────────────────────────────────

const asArray = value => (Array.isArray(value) ? value : [])

const useSessions = () =>
	useQuery({
		queryKey: [ID, 'sessions'],
		queryFn: async () => asArray((await host.request('session.list', { limit: 200 }))?.sessions),
		staleTime: 30_000
	})

const useSkills = () =>
	useQuery({
		queryKey: [ID, 'skills'],
		queryFn: async () => asArray(await host.skills.list()),
		staleTime: 120_000
	})

const useToolsets = () =>
	useQuery({
		queryKey: [ID, 'toolsets'],
		queryFn: async () => asArray(await host.toolsets.list()),
		staleTime: 120_000
	})

const useProfiles = () =>
	useQuery({
		queryKey: [ID, 'profiles'],
		queryFn: async () => asArray(await host.profiles.list()),
		staleTime: 120_000
	})

// ── roster handoff ──────────────────────────────────────────────────────────
//
// `PaletteContribution.items()` is SYNCHRONOUS — it cannot await — while the
// data behind it arrives from queries. The launcher publishes its item list
// here on every render; the palette reads the latest snapshot when it opens.
// This module-level cache is the whole handoff, and it is the only place a
// React surface and a synchronous contribution contract meet.
//
// Bounded on purpose: a roster of 400 rows is a list nobody scans. Chats and
// skills are the high-volume groups, so they get the tightest caps.

const ROSTER_CAP = 120
const GROUP_CAPS = { session: 40, skill: 40, toolset: 30, cron: 30, profile: 30 }

let roster = []

export const publishRoster = items => {
	const list = Array.isArray(items) ? items : []
	const counts = {}

	roster = list
		.filter(item => {
			const cap = GROUP_CAPS[item.group] ?? 20
			counts[item.group] = (counts[item.group] ?? 0) + 1

			return counts[item.group] <= cap
		})
		.slice(0, ROSTER_CAP)
}

export const rosterSnapshot = () => roster

/** A roster item as a core-palette row. `detail` is a function by contract. */
export const rowForPalette = item => ({
	id: item.id,
	label: item.label,
	keywords: [groupOf(item.group)?.label ?? '', item.keywords ?? ''].filter(Boolean).join(' '),
	detail: item.detail ? () => item.detail : undefined,
	run: item.run
})

// ── actions ─────────────────────────────────────────────────────────────────

/**
 * Stage a skill as its slash command instead of firing it: a skill takes
 * arguments, so auto-submitting an empty one burns a turn on a prompt with no
 * request in it.
 */
const stageSkill = async name => {
	const ok = await host.composer.setDraft(null, `/${name} `)

	if (ok) {
		host.composer.focus(null)
	}

	return ok
}

const triggerCron = async job => {
	const name = job?.name || job?.id || 'job'
	const result = await host.request('cli.exec', { argv: ['cron', 'run', String(job?.id ?? '')], timeout: 60 })

	if (result?.blocked) {
		host.notifyError(`Jump: ${name} — ${result.hint || 'blocked'}`)
	} else if (result?.code !== 0) {
		host.notifyError(`Jump: ${name} failed (exit ${result?.code})`)
	} else {
		host.notify({ kind: 'success', message: `Jump: queued ${name}` })
	}
}

// ── items ───────────────────────────────────────────────────────────────────

/**
 * Build the row list. Inert data plus a `run` per row — the launcher and the
 * palette both consume this shape, so the two surfaces cannot drift.
 */
const useItems = () => {
	const sessionsQuery = useSessions()
	const skillsQuery = useSkills()
	const toolsetsQuery = useToolsets()
	const profilesQuery = useProfiles()
	const cronJobs = useValue(host.state.cronJobs)
	const activeProfile = useValue(host.state.profile)

	const sessions = sessionsQuery.data
	const skills = skillsQuery.data
	const toolsets = toolsetsQuery.data
	const profiles = profilesQuery.data

	return useMemo(() => {
		const items = []

		for (const session of asArray(sessions)) {
			items.push({
				group: 'session',
				id: `session:${session.id}`,
				label: session.title || 'Untitled chat',
				// The preview is what makes a chat findable by what it was ABOUT,
				// not only by what it was named.
				keywords: [session.preview, session.source].filter(Boolean).join(' '),
				detail: session.preview ? session.preview.slice(0, 90) : String(session.id || ''),
				weight: 1.15,
				run: () => host.openSession(session.id)
			})
		}

		for (const skill of asArray(skills)) {
			items.push({
				group: 'skill',
				id: `skill:${skill.name}`,
				label: skill.name,
				keywords: [skill.description, skill.category].filter(Boolean).join(' '),
				detail: skill.description || skill.category || '',
				badge: skill.enabled === false ? 'off' : null,
				run: () => stageSkill(skill.name)
			})
		}

		for (const toolset of asArray(toolsets)) {
			items.push({
				group: 'toolset',
				id: `toolset:${toolset.name}`,
				label: toolset.label || toolset.name,
				keywords: toolset.description || '',
				detail: toolset.description || '',
				badge: toolset.enabled ? 'on' : 'off',
				run: () => host.toolsets.setEnabled(toolset.name, !toolset.enabled)
			})
		}

		for (const job of asArray(cronJobs)) {
			const label = job.name || job.id

			items.push({
				group: 'cron',
				id: `cron:${job.id}`,
				label: `Run ${label}`,
				keywords: [job.prompt, job.schedule_display].filter(Boolean).join(' '),
				detail: job.schedule_display || String(job.id || ''),
				badge: job.enabled === false ? 'paused' : job.state === 'running' ? 'running' : null,
				run: () => triggerCron(job)
			})
		}

		for (const entry of asArray(profiles)) {
			if (entry.is_default) {
				continue
			}

			items.push({
				group: 'profile',
				id: `profile:${entry.name}`,
				label: entry.display_name || entry.name,
				keywords: [entry.model, entry.provider].filter(Boolean).join(' '),
				detail: entry.model || entry.name,
				badge: entry.name === activeProfile ? 'active' : null,
				// `host` exposes no profile-switch door, so this opens the
				// Profiles page rather than pretending to switch.
				run: () => host.navigate('/profiles')
			})
		}

		return items
	}, [sessions, skills, toolsets, cronJobs, profiles, activeProfile])
}

// ── rendering ───────────────────────────────────────────────────────────────

const ItemRow = ({ active, item, onRun }) =>
	jsx(
		'button',
		{
			type: 'button',
			onClick: () => onRun(item, false),
			// Pointer movement moves the highlight only — it never fires a row.
			onMouseMove: () => onRun(item, true),
			className: cn(
				'flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left transition-colors',
				active
					? 'bg-(--chrome-action-hover) text-foreground'
					: 'text-(--ui-text-secondary) hover:bg-(--chrome-action-hover)'
			)
		},
		jsx(Codicon, {
			name: groupOf(item.group)?.icon ?? 'symbol-misc',
			className: 'shrink-0 text-(--ui-text-tertiary)'
		}),
		jsx(
			'span',
			{ className: 'min-w-0 flex-1' },
			jsx('span', { className: 'block truncate text-sm font-medium', children: item.label }),
			item.detail
				? jsx('span', { className: 'block truncate text-xs text-(--ui-text-tertiary)', children: item.detail })
				: null
		),
		item.badge
			? jsx(Badge, {
					variant: item.badge === 'off' || item.badge === 'paused' ? 'muted' : 'outline',
					size: 'xs',
					children: item.badge
				})
			: null
	)

const JumpLauncher = () => {
	const t = usePluginI18n(ID)
	const items = useItems()

	const [query, setQuery] = useState('')
	const [cursor, setCursor] = useState(0)
	// Read in a ref so the keyboard handler never closes over a stale rank.
	const rankedRef = useRef([])

	const ranked = useMemo(() => fuzzyRank(items, query), [items, query])

	rankedRef.current = ranked

	// Keep the palette's roster in step with what the launcher is showing.
	useEffect(() => {
		publishRoster(ranked)
	}, [ranked])

	// Grouped for display, but the cursor walks the flat ranking so ↓ always
	// follows the order the user can see.
	const sections = useMemo(() => {
		const byGroup = new Map()

		for (const item of ranked) {
			if (!byGroup.has(item.group)) {
				byGroup.set(item.group, [])
			}

			byGroup.get(item.group).push(item)
		}

		return GROUPS.filter(group => byGroup.has(group.id)).map(group => ({
			group,
			items: byGroup.get(group.id)
		}))
	}, [ranked])

	const run = useCallback((item, hoverOnly) => {
		if (!item) {
			return
		}

		if (hoverOnly) {
			setCursor(rankedRef.current.indexOf(item))

			return
		}

		item.run()
	}, [])

	// Clamp the cursor whenever the result set shrinks under it.
	useEffect(() => {
		setCursor(current => (current >= ranked.length ? 0 : current))
	}, [ranked.length])

	const loading =
		!items.length &&
		Boolean(host.state.gateway.get() === 'connecting')

	const onKeyDown = event => {
		const list = rankedRef.current

		if (event.key === 'ArrowDown') {
			event.preventDefault()
			setCursor(current => (list.length ? (current + 1) % list.length : 0))
		} else if (event.key === 'ArrowUp') {
			event.preventDefault()
			setCursor(current => (list.length ? (current - 1 + list.length) % list.length : 0))
		} else if (event.key === 'Enter') {
			event.preventDefault()
			run(list[cursor])
		}
	}

	return jsxs(
		'div',
		{ className: 'mx-auto flex h-full w-full max-w-3xl flex-col gap-3 overflow-hidden p-4' },
		jsx(SearchField, {
			value: query,
			onChange: value => {
				setQuery(value)
				setCursor(0)
			},
			onKeyDown,
			placeholder: t('placeholder'),
			variant: 'box',
			'aria-label': t('placeholder')
		}),
		loading
			? jsx('div', { className: 'grid min-h-32 place-items-center' }, jsx(GlyphSpinner, { className: 'text-(--ui-text-tertiary)' }))
			: ranked.length === 0
				? jsx(EmptyState, {
						title: t('noResults'),
						description: query ? t('noResultsHint') : t('idleHint')
					})
				: jsx(
						'div',
						{ className: 'min-h-0 flex-1 overflow-y-auto' },
						sections.map((section, index) =>
							jsxs(
								'div',
								{ key: section.group.id, className: 'pb-2' },
								index > 0 ? jsx(Separator, { className: 'my-1.5' }) : null,
								jsx('div', {
									className:
										'px-2.5 pb-1 pt-1 text-[0.6875rem] font-medium uppercase tracking-wide text-(--ui-text-quaternary)',
									children: section.group.label
								}),
								section.items.map(item =>
									jsx(ItemRow, {
										key: item.id,
										item,
										active: ranked[cursor]?.id === item.id,
										onRun: run
									})
								)
							)
						)
					),
		jsx('div', { className: 'shrink-0 text-[0.6875rem] text-(--ui-text-quaternary)', children: t('hint') })
	)
}

export default {
	id: ID,
	name: 'Jump',
	description: 'Fuzzy launcher across chats, skills, toolsets, scheduled jobs and profiles.',

	register(ctx) {
		ctx.i18n.register({
			en: {
				placeholder: 'Jump to a chat, skill, toolset, scheduled job or profile…',
				noResults: 'No matches',
				noResultsHint: 'Nothing matches that. Try fewer characters.',
				idleHint: 'Start typing to filter.',
				hint: '↑↓ to move · ↵ to open'
			}
		})

		// The launcher as a layout pane — draggable like any core pane.
		ctx.register({
			id: 'pane',
			area: PANES_AREA,
			title: 'jump',
			data: { placement: 'main', width: '520px', height: '420px' },
			render: () => jsx(JumpLauncher, {})
		})

		// …and as a full page, reachable from the sidebar, ⌘K or the keybind.
		ctx.register({
			id: 'page',
			area: ROUTES_AREA,
			data: { path: ROUTE },
			render: () => jsx(JumpLauncher, {})
		})

		ctx.register({
			id: 'nav',
			area: SIDEBAR_NAV_AREA,
			order: 60,
			data: { path: ROUTE, label: 'Jump', codicon: 'search' }
		})

		// The roster door INTO core ⌘K. `items()` is re-read on every palette
		// mount, so rows stay live without a plugin reload.
		ctx.register({
			id: 'roster',
			area: PALETTE_AREA,
			data: {
				id: `${ID}.roster`,
				label: 'Jump: chats, skills, toolsets, scheduled jobs…',
				keywords: ['jump', 'launcher', 'go to', 'fuzzy', 'skill', 'cron', 'toolset', 'profile'],
				run: () => host.navigate(ROUTE),
				items: () => rosterSnapshot().map(rowForPalette)
			}
		})

		ctx.register({
			id: 'open',
			area: PALETTE_AREA,
			data: {
				id: `${ID}.open`,
				label: 'Open Jump launcher',
				keywords: ['jump', 'launcher', 'fuzzy', 'quick'],
				run: () => host.navigate(ROUTE)
			}
		})

		ctx.register({
			id: 'keybind',
			area: KEYBINDS_AREA,
			data: {
				id: `${ID}.open`,
				category: 'navigation',
				defaults: ['mod+shift+j'],
				label: 'Jump launcher',
				run: () => host.navigate(ROUTE)
			}
		})
	}
}