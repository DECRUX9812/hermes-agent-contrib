/**
 * G1 — the mission rail's collapse pref contract:
 *   1. folding a section persists under `mission-rail-v1` scoped to that
 *      section's id;
 *   2. hydrate restores folds only for section ids that still exist —
 *      a removed section's stored bit must never wedge the pref.
 */

import type * as HermesSdk from '@hermes/plugin-sdk'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { scriptedStorage } from './group-test-utils'

vi.mock('@hermes/plugin-sdk', async importOriginal => {
  const sdk = await importOriginal<typeof HermesSdk>()

  return {
    ...sdk,
    host: { ...sdk.host, notify: vi.fn(), notifyError: vi.fn() }
  }
})

const { hydrateRailSections, hydrateRailTab, $railCollapsed, $railTab, setRailSectionCollapsed, setRailTab } =
  await import('./rail-state')

const shared = await import('./shared')

const storage = new Map<string, unknown>()

beforeEach(() => {
  storage.clear()
  shared.setPluginCtx(scriptedStorage(storage))
  $railCollapsed.set({})
})

describe('rail section collapse pref', () => {
  it('persists a fold scoped to the section id', async () => {
    setRailSectionCollapsed('routines', true)
    setRailSectionCollapsed('computer', true)

    expect($railCollapsed.get()).toEqual({ computer: true, routines: true })
    expect(storage.get('mission-rail-v1')).toEqual({ computer: true, routines: true })

    setRailSectionCollapsed('routines', false)

    expect($railCollapsed.get()).toEqual({ computer: true })
    expect(storage.get('mission-rail-v1')).toEqual({ computer: true })
  })

  it('hydrates stored folds and drops unknown section ids', async () => {
    storage.set('mission-rail-v1', { 'gone-section': true, routines: true, tasks: 'yes' })

    hydrateRailSections()
    await Promise.resolve()

    expect($railCollapsed.get()).toEqual({ routines: true })
  })

  it('does not let a late stored preference overwrite a tab the user just selected', async () => {
    let finish!: (value: string) => void
    const ctx = scriptedStorage(storage)
    ctx.storage.get = vi.fn().mockReturnValue(
      new Promise(resolve => {
        finish = resolve
      })
    )
    shared.setPluginCtx(ctx)
    hydrateRailTab()
    setRailTab('bot')
    finish('scheduled')
    await Promise.resolve()
    expect($railTab.get()).toBe('bot')
  })

  it('keeps a user fold made while storage was being read', async () => {
    let finish!: (value: Record<string, boolean>) => void
    const ctx = scriptedStorage(storage)
    ctx.storage.get = vi.fn().mockReturnValue(
      new Promise(resolve => {
        finish = resolve
      })
    )
    shared.setPluginCtx(ctx)
    hydrateRailSections()
    setRailSectionCollapsed('computer', true)
    finish({ routines: true })
    await Promise.resolve()
    expect($railCollapsed.get()).toEqual({ computer: true })
  })
})
