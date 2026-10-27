/**
 * Connect — the optional first-run "Connect your tools" card: GitHub sign-in
 * through the gateway computer's gh CLI, and a Cloudflare quick tunnel that puts
 * the Webapp on a public HTTPS address behind Nous sign-in.
 *
 * It talks only to this package's own backend (`plugins/hermes-connect`,
 * mounted at /api/plugins/hermes-connect) through `ctx.rest`. The tunnel
 * routes there answer only the native app on the gateway's computer.
 *
 * Placement: core's `chat.intro` area, under the new-chat intro, once. It shows
 * on a fresh install (no sessions yet) until Continue or Skip, and never for
 * someone who already has chats. Both cards are optional.
 *
 * Plain ESM, loaded uncompiled. UI is jsx() calls, not JSX syntax.
 */

import { Button, CHAT_INTRO_AREA, cn, Codicon, host, usePluginI18n } from '@hermes/plugin-sdk'
import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { jsx, jsxs } from 'react/jsx-runtime'

const ID = 'hermes-connect'
const CARD_KEY = 'firstRunCard' // 'pending' | 'done'
const GITHUB_POLL_MS = 2000
const GITHUB_DEVICE_URL = 'https://github.com/login/device'
/** Starting a tunnel also restarts the gateway onto web access, which can build the Webapp first. */
const TUNNEL_START_TIMEOUT_MS = 35 * 60_000

const EN = {
	title: 'Connect your tools',
	intro: 'Both are optional. You can change them later in Settings.',
	github: {
		title: 'GitHub',
		desc: 'Lets Hermes clone, push and open pull requests as you.',
		signIn: 'Sign in with GitHub',
		signedIn: account => `Signed in as ${account}`,
		signedInNoName: 'Signed in',
		notInstalled: 'Install the GitHub CLI (gh) on this computer to sign in here.',
		codeLabel: 'Enter this code on GitHub',
		openPage: 'Open github.com/login/device',
		waiting: 'Waiting for you to approve on GitHub…',
		cancel: 'Cancel',
		failed: "GitHub sign-in didn't finish.",
		retry: 'Try again'
	},
	remote: {
		title: 'Remote access',
		desc: 'Open Hermes from your phone or another computer, behind your Nous sign-in.',
		localOnly: 'This computer only',
		localOnlyDesc: 'Nothing is exposed. The default.',
		tunnel: 'Quick tunnel',
		tunnelDesc: 'A free Cloudflare HTTPS address. It changes each time the tunnel starts.',
		start: 'Start tunnel',
		starting: 'Starting…',
		stop: 'Stop',
		running: 'Live at',
		stale: 'Web access still points at an old tunnel address. Start the tunnel again to refresh it.',
		noCloudflared: 'Install cloudflared on this computer to use a quick tunnel.',
		ownDomain: 'Use my own domain',
		hostOnly: 'Remote access is set up from Hermes Desktop on the computer running Hermes.',
		failed: "Couldn't start the tunnel"
	},
	skip: 'Skip for now',
	continue: 'Continue'
}

// ── first-run state ─────────────────────────────────────────────────────────

let rest = null
let storage = null
let cardState = null // null (undecided) | 'pending' | 'done'
const listeners = new Set()

const setCardState = next => {
	cardState = next
	storage?.set(CARD_KEY, next)
	listeners.forEach(fn => fn())
}

const useCardState = () =>
	useSyncExternalStore(
		fn => (listeners.add(fn), () => listeners.delete(fn)),
		() => cardState
	)

/** Decide once per install: a fresh one (no chats yet) sees the card; anyone with history doesn't.
 *  Plugins register before the gateway may be up, so a failed ask retries a few times. */
let retryTimer = null

async function decideFirstRun(attempt = 0) {
	const stored = storage.get(CARD_KEY, null)

	if (stored === 'pending' || stored === 'done') {
		cardState = stored
		listeners.forEach(fn => fn())

		return
	}

	try {
		const res = await host.request('session.list', { limit: 1 })

		if (storage) {
			setCardState(Array.isArray(res?.sessions) && res.sessions.length > 0 ? 'done' : 'pending')
		}
	} catch {
		// Undecided stays hidden; ask again shortly, then on the next start.
		if (storage && attempt < 20) {
			retryTimer = setTimeout(() => void decideFirstRun(attempt + 1), 1500)
		}
	}
}

// ── UI ──────────────────────────────────────────────────────────────────────

function useMounted() {
	const mounted = useRef(true)

	useEffect(
		() => () => {
			mounted.current = false
		},
		[]
	)

	return mounted
}

const errorText = (err, fallback) => (err instanceof Error && err.message ? err.message : fallback)

function Card({ children, icon, title, desc }) {
	return jsxs('section', {
		className: 'grid gap-3 rounded-2xl border border-(--ui-stroke-tertiary) bg-background p-4',
		children: [
			jsxs('div', {
				className: 'flex items-start gap-3',
				children: [
					jsx('span', { className: 'mt-0.5 text-(--ui-text-secondary)', children: jsx(Codicon, { name: icon, size: '0.95rem' }) }),
					jsxs('div', {
						className: 'min-w-0',
						children: [
							jsx('h3', { className: 'text-sm font-medium text-foreground', children: title }),
							jsx('div', { className: 'text-xs text-muted-foreground', children: desc })
						]
					})
				]
			}),
			children
		]
	})
}

const Spinner = () => jsx(Codicon, { className: 'animate-spin text-muted-foreground', name: 'loading', size: '0.9rem' })

const Done = ({ children }) =>
	jsxs('div', {
		className: 'flex flex-wrap items-center gap-1.5 text-sm text-foreground',
		role: 'status',
		children: [jsx(Codicon, { className: 'text-primary', name: 'check', size: '0.85rem' }), ...[].concat(children)]
	})

const Link = ({ href, children, className }) =>
	jsx('a', { className: cn('text-primary underline-offset-2 hover:underline', className), href, rel: 'noreferrer', target: '_blank', children })

function GithubCard({ t }) {
	const mounted = useMounted()
	const [status, setStatus] = useState(null)
	const [busy, setBusy] = useState(false)
	const [error, setError] = useState(null)

	useEffect(() => {
		rest('/github').then(
			next => mounted.current && setStatus(next),
			() => mounted.current && setStatus({ account: null, authenticated: false, available: false, login: null })
		)
	}, [mounted])

	const pending = status?.login?.state === 'pending' && !status.authenticated

	// gh finishes the device flow on its own; poll until it reports the account.
	useEffect(() => {
		if (!pending) {
			return
		}

		const timer = window.setInterval(() => {
			rest('/github').then(next => mounted.current && setStatus(next), () => undefined)
		}, GITHUB_POLL_MS)

		return () => window.clearInterval(timer)
	}, [mounted, pending])

	const start = async () => {
		setBusy(true)
		setError(null)

		try {
			const login = await rest('/github/login', { method: 'POST' })
			mounted.current && setStatus(prev => ({ account: null, authenticated: false, available: true, ...prev, login }))
		} catch (err) {
			mounted.current && setError(errorText(err, t('github.failed')))
		} finally {
			mounted.current && setBusy(false)
		}
	}

	const cancel = () => {
		rest('/github/login', { method: 'DELETE' })
			.catch(() => undefined)
			.finally(() => mounted.current && setStatus(prev => (prev ? { ...prev, login: null } : prev)))
	}

	const failed = status?.login?.state === 'failed' && !status.authenticated

	let body

	if (status === null) {
		body = jsx(Spinner, {})
	} else if (status.authenticated) {
		body = jsx(Done, { children: status.account ? t('github.signedIn', status.account) : t('github.signedInNoName') })
	} else if (!status.available) {
		body = jsx('div', { className: 'text-xs text-muted-foreground', children: t('github.notInstalled') })
	} else if (pending && status.login?.user_code) {
		body = jsxs('div', {
			className: 'grid gap-2',
			children: [
				jsx('span', { className: 'text-xs text-muted-foreground', children: t('github.codeLabel') }),
				jsx('code', {
					className: 'w-fit select-all rounded-lg bg-(--ui-bg-tertiary) px-3 py-1.5 font-mono text-lg tracking-widest text-foreground',
					children: status.login.user_code
				}),
				jsxs('div', {
					className: 'flex flex-wrap items-center gap-3',
					children: [
						jsx(Link, { className: 'text-sm', href: status.login.verification_url || GITHUB_DEVICE_URL, children: t('github.openPage') }),
						jsx(Button, { onClick: cancel, size: 'xs', type: 'button', variant: 'text', children: t('github.cancel') })
					]
				}),
				jsxs('div', {
					className: 'flex items-center gap-1.5 text-xs text-muted-foreground',
					children: [jsx(Spinner, {}), t('github.waiting')]
				})
			]
		})
	} else {
		body = jsxs('div', {
			className: 'grid gap-2',
			children: [
				failed || error
					? jsx('div', { className: 'text-xs text-destructive', children: error ?? status.login?.detail ?? t('github.failed') })
					: null,
				jsxs(Button, {
					className: 'w-fit',
					disabled: busy,
					onClick: () => void start(),
					size: 'sm',
					type: 'button',
					variant: 'outline',
					children: [busy ? jsx(Spinner, {}) : null, failed ? t('github.retry') : t('github.signIn')]
				})
			]
		})
	}

	return jsx(Card, { desc: t('github.desc'), icon: 'github', title: t('github.title'), children: body })
}

/** The tunnel exposes the computer the gateway runs on: only the native app there may change it. */
const nativeHost = () => document.documentElement.dataset.hermesDesktopHost !== 'browser'

function RemoteCard({ t, onOwnDomain }) {
	const native = nativeHost()
	const mounted = useMounted()
	const [status, setStatus] = useState(null)
	const [busy, setBusy] = useState(null)
	const [error, setError] = useState(null)

	useEffect(() => {
		if (!native) {
			return
		}

		rest('/tunnel').then(
			next => mounted.current && setStatus(next),
			() => mounted.current && setStatus({ cloudflared: false, port: null, running: false, stale: false, url: null })
		)
	}, [mounted, native])

	const run = async kind => {
		setBusy(kind)
		setError(null)

		try {
			const { tunnel } = await rest(kind === 'start' ? '/tunnel/start' : '/tunnel/stop', {
				method: 'POST',
				...(kind === 'start' ? { timeoutMs: TUNNEL_START_TIMEOUT_MS } : {})
			})
			mounted.current && setStatus(prev => ({ cloudflared: true, port: null, stale: false, ...prev, ...tunnel }))
		} catch (err) {
			mounted.current && setError(`${t('remote.failed')}: ${errorText(err, '')}`.replace(/: $/, ''))
		} finally {
			mounted.current && setBusy(null)
		}
	}

	let body

	if (!native) {
		body = jsx('div', { className: 'text-xs text-muted-foreground', children: t('remote.hostOnly') })
	} else if (status === null) {
		body = jsx(Spinner, {})
	} else {
		const option = (label, desc) =>
			jsxs('span', { children: [jsx('span', { className: 'font-medium text-foreground', children: label }), ` — ${desc}`] })

		body = jsxs('div', {
			className: 'grid gap-2',
			children: [
				status.running && status.url
					? jsx(Done, { children: [t('remote.running'), jsx(Link, { className: 'font-mono text-xs', href: status.url, children: status.url }, 'url')] })
					: jsxs('div', {
							className: 'grid gap-1 text-xs text-muted-foreground',
							children: [option(t('remote.localOnly'), t('remote.localOnlyDesc')), option(t('remote.tunnel'), t('remote.tunnelDesc'))]
						}),
				status.stale && !status.running ? jsx('div', { className: 'text-xs text-(--ui-text-secondary)', children: t('remote.stale') }) : null,
				!status.cloudflared && !status.running ? jsx('div', { className: 'text-xs text-muted-foreground', children: t('remote.noCloudflared') }) : null,
				error ? jsx('div', { className: 'text-xs text-destructive', children: error }) : null,
				jsxs('div', {
					className: 'flex flex-wrap items-center gap-3',
					children: [
						status.running
							? jsxs(Button, {
									disabled: busy !== null,
									onClick: () => void run('stop'),
									size: 'sm',
									type: 'button',
									variant: 'outline',
									children: [busy === 'stop' ? jsx(Spinner, {}) : null, t('remote.stop')]
								})
							: jsxs(Button, {
									disabled: busy !== null || !status.cloudflared,
									onClick: () => void run('start'),
									size: 'sm',
									type: 'button',
									variant: 'outline',
									children: [busy === 'start' ? jsx(Spinner, {}) : null, busy === 'start' ? t('remote.starting') : t('remote.start')]
								}),
						jsx('a', {
							className: 'text-xs text-(--ui-text-secondary) underline-offset-2 hover:underline',
							href: '#/settings?tab=web-access',
							onClick: onOwnDomain,
							children: t('remote.ownDomain')
						})
					]
				})
			]
		})
	}

	return jsx(Card, { desc: t('remote.desc'), icon: 'globe', title: t('remote.title'), children: body })
}

function ConnectCard() {
	const t = usePluginI18n(ID)
	const state = useCardState()

	if (state !== 'pending') {
		return null
	}

	const done = () => setCardState('done')

	// The intro caps its direct children at the composer width and centres
	// trailing paragraphs, so the card sits in its own narrower column.
	return jsx('div', {
		className: 'pointer-events-auto mt-6 flex w-full justify-center',
		'data-slot': 'intro_connect',
		children: jsxs('div', {
			className: 'grid w-full max-w-md gap-3 text-left',
			children: [
				jsxs('div', {
					children: [
						jsx('h2', { className: 'text-sm font-semibold tracking-tight text-foreground', children: t('title') }),
						jsx('div', { className: 'mt-0.5 text-xs text-(--ui-text-tertiary)', children: t('intro') })
					]
				}),
				jsx(GithubCard, { t }),
				jsx(RemoteCard, { onOwnDomain: done, t }),
				jsxs('div', {
					className: 'flex items-center justify-between gap-3',
					children: [
						jsx(Button, { className: 'font-medium', onClick: done, size: 'xs', type: 'button', variant: 'text', children: t('skip') }),
						jsx(Button, { onClick: done, size: 'sm', type: 'button', children: t('continue') })
					]
				})
			]
		})
	})
}

export default {
	id: ID,
	name: 'Connect',
	description: 'First-run card under the new-chat intro: GitHub sign-in and a quick tunnel for remote access.',

	register(ctx) {
		rest = ctx.rest
		storage = ctx.storage
		ctx.i18n.register({ en: EN })
		void decideFirstRun()
		ctx.register({ id: 'first-run', area: CHAT_INTRO_AREA, order: 20, render: () => jsx(ConnectCard, {}) })
	},

	onDispose() {
		clearTimeout(retryTimer)
		rest = null
		storage = null
		cardState = null
	}
}
