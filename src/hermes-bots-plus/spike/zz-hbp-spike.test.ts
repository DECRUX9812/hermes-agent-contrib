// TEMPORARY spike harness (not for commit): loads the overlay's hermes-bots-plus
// bundle through the real runtime loader and renders each contribution.
import { readFileSync, writeFileSync } from 'node:fs'

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, render } from '@testing-library/react'
import { Component, createElement, type ReactNode } from 'react'
import { expect, it, vi } from 'vitest'

import type { HermesApiRequest } from '@/global'

import { $pluginRecords } from './plugins-store'
import { registry } from './registry'
import { discoverRuntimePlugins } from './runtime-loader'

const ROOT = '/home/u/.hermes/desktop-plugins'
const BUNDLE = process.env.HBP_BUNDLE || new URL('../../../desktop-plugins/hermes-bots-plus/plugin.js', import.meta.url).pathname

vi.mock('@/api/client', async importActual => {
  const actual = await importActual<Record<string, unknown>>()

  return {
    ...actual,
    hermesApi: async (request: HermesApiRequest) => {
      const url = new URL(request.path, 'http://x')

      if (url.pathname === '/api/desktop-plugins/root') return { root: ROOT }
      if (url.pathname === '/api/desktop-plugins/list') {
        return url.searchParams.get('name')
          ? { entries: [{ isDirectory: false, name: 'plugin.js', path: `${ROOT}/hermes-bots-plus/plugin.js` }] }
          : { entries: [{ isDirectory: true, name: 'hermes-bots-plus', path: `${ROOT}/hermes-bots-plus` }] }
      }
      if (url.pathname === '/api/desktop-plugins/source') {
        if (url.searchParams.get('file') !== 'plugin.js') throw new Error('File not found')
        const text = readFileSync(BUNDLE, 'utf8')

        return { byteSize: text.length, name: 'plugin.js', path: `${ROOT}/hermes-bots-plus/plugin.js`, text }
      }
      throw new Error(`no api in spike: ${url.pathname}`)
    }
  }
})

class Boundary extends Component<{ children: ReactNode; onError: (e: unknown) => void }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  componentDidCatch(error: unknown) {
    this.props.onError(error)
  }
  render() {
    return this.state.failed ? null : this.props.children
  }
}

function msg(e: unknown) {
  return String((e as Error)?.message ?? e).split('\n')[0].slice(0, 300)
}

it('spike: hermes-bots-plus on Nous main', async () => {
  const createObjectURL = vi
    .spyOn(URL, 'createObjectURL')
    .mockImplementation(
      blob => `data:text/javascript;base64,${Buffer.from((blob as unknown as { parts: string[] }).parts.join('')).toString('base64')}`
    )
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined)
  const RealBlob = globalThis.Blob
  vi.stubGlobal('Blob', class { parts: string[]; constructor(parts: string[]) { this.parts = parts } })

  const { installBrowserDesktopPluginCapability } = await import('@/lib/browser-desktop-plugins')
  installBrowserDesktopPluginCapability()

  const consoleErrors: string[] = []
  const origError = console.error
  console.error = (...args: unknown[]) => {
    consoleErrors.push(args.map(msg).join(' '))
    for (const a of args) if (a instanceof Error && a.stack) consoleErrors.push('STACK ' + a.stack.split('\n').slice(0, 8).join(' | ').slice(0, 1500))
  }
  const origWarn = console.warn
  console.warn = (...args: unknown[]) => consoleErrors.push('[warn] ' + args.map(msg).join(' '))

  try {
    await discoverRuntimePlugins()
  } finally {
    createObjectURL.mockRestore()
    vi.stubGlobal('Blob', RealBlob)
  }

  const record = $pluginRecords.get()['hermes-bots-plus']
  const loadErrors = consoleErrors.splice(0)
  const byArea = (registry as unknown as { byArea: Map<string, { area: string; id: string; render?: () => ReactNode; source?: unknown }[]> }).byArea
  const contributions = [...byArea.values()].flat().filter(c => String(c.id).startsWith('hermes-bots-plus') || JSON.stringify(c.source ?? '').includes('hermes-bots-plus'))
  const renders: { area: string; error?: string; id: string; logs: string[]; ok: boolean }[] = []

  for (const c of contributions) {
    if (typeof c.render !== 'function') {
      renders.push({ area: c.area, id: c.id, logs: [], ok: true })
      continue
    }
    let error: string | undefined
    const Probe = () => c.render!() as ReactNode
    try {
      let view: ReturnType<typeof render> | undefined
      await act(async () => {
        view = render(
          createElement(
            QueryClientProvider,
            { client: new QueryClient() },
            createElement(Boundary, { onError: e => (error = msg(e)) }, createElement(Probe))
          )
        )
        await new Promise(resolve => setTimeout(resolve, 30))
      })
      view?.unmount()
    } catch (e) {
      error = msg(e)
    }
    renders.push({ area: c.area, error, id: c.id, logs: consoleErrors.splice(0).slice(0, 5), ok: !error })
  }

  console.error = origError
  console.warn = origWarn

  const report = {
    compat: (globalThis as { __hermesBotsPlusCompat?: unknown }).__hermesBotsPlusCompat ?? null,
    contributions: contributions.length,
    loadErrors: loadErrors.slice(0, 30),
    record: record ? { error: (record as { error?: unknown }).error, kind: record.kind, status: record.status } : null,
    renders
  }
  writeFileSync('/tmp/hbp-spike.json', JSON.stringify(report, null, 2))
  expect(report).toBeDefined()
}, 120_000)
