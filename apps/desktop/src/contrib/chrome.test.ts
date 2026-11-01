import { describe, expect, it } from 'vitest'

import { CHROME_PLUGIN_ROWS, pluginDisplayName, pluginIdFromSource, splitChrome } from './chrome'

interface Row {
  id: string
  source?: string
}

const pluginOf = (row: Row) => (row.source?.startsWith('plugin:') ? row.source.slice('plugin:'.length) : null)

const core = (id: string): Row => ({ id })
const plugin = (pid: string, id = `${pid}:row`): Row => ({ id, source: `plugin:${pid}` })

describe('pluginIdFromSource', () => {
  it('extracts the plugin id from a provenance tag', () => {
    expect(pluginIdFromSource('plugin:kanban')).toBe('kanban')
    expect(pluginIdFromSource('plugin:hermes-teams')).toBe('hermes-teams')
  })

  it('treats core and malformed tags as no plugin', () => {
    expect(pluginIdFromSource('core')).toBeNull()
    expect(pluginIdFromSource('plugin:')).toBeNull()
    expect(pluginIdFromSource(undefined)).toBeNull()
    expect(pluginIdFromSource(null)).toBeNull()
  })
})

describe('splitChrome', () => {
  it('keeps core rows inline and never charges them to the plugin budget', () => {
    const rows = [core('new-session'), core('capabilities'), core('messaging')]
    const { inline, overflow } = splitChrome(rows, pluginOf)

    expect(inline.map(r => r.id)).toEqual(['new-session', 'capabilities', 'messaging'])
    expect(overflow).toEqual([])
  })

  it('lets CHROME_PLUGIN_ROWS plugin rows through and overflows the rest', () => {
    const rows = [
      core('new-session'),
      plugin('chief'),
      plugin('rigforge'),
      plugin('work'),
      plugin('teams'),
      plugin('pixel-office')
    ]

    const { inline, overflow } = splitChrome(rows, pluginOf)

    expect(inline.map(r => r.id)).toEqual(['new-session', 'chief:row', 'rigforge:row', 'work:row'])
    expect(overflow.map(r => r.id)).toEqual(['teams:row', 'pixel-office:row'])
    expect(inline.length + overflow.length).toBe(rows.length)
  })

  it('preserves order inside each bucket', () => {
    const rows = [plugin('a'), plugin('b'), plugin('c'), plugin('d')]
    const { inline, overflow } = splitChrome(rows, pluginOf, 2)

    expect(inline.map(r => r.id)).toEqual(['a:row', 'b:row'])
    expect(overflow.map(r => r.id)).toEqual(['c:row', 'd:row'])
  })

  it('honours a custom budget, including zero (all plugins overflow)', () => {
    const rows = [core('capabilities'), plugin('chief')]
    expect(splitChrome(rows, pluginOf, 0).overflow.map(r => r.id)).toEqual(['chief:row'])
    expect(splitChrome(rows, pluginOf, 0).inline.map(r => r.id)).toEqual(['capabilities'])
  })

  it('defaults to CHROME_PLUGIN_ROWS', () => {
    const rows = Array.from({ length: CHROME_PLUGIN_ROWS + 2 }, (_, i) => plugin(`p${i}`))
    const { inline, overflow } = splitChrome(rows, pluginOf)

    expect(inline).toHaveLength(CHROME_PLUGIN_ROWS)
    expect(overflow).toHaveLength(2)
  })
})

describe('pluginDisplayName', () => {
  it('prefers the inventory name', () => {
    expect(pluginDisplayName('hermes-teams', 'Hermes Teams')).toBe('Hermes Teams')
  })

  it('humanizes the id when the inventory has no record', () => {
    expect(pluginDisplayName('hermes-teams')).toBe('Hermes Teams')
    expect(pluginDisplayName('plugin:rigforge')).toBe('Rigforge')
  })
})
