import { afterEach, describe, expect, it } from 'vitest'

import type { ToolPart } from '@/components/assistant-ui/tool/fallback-model'
import { setRuntimeI18nLocale } from '@/i18n'

import { groupToolCards, toolCardFamily, toolCardsFromParts, toolCardView } from './model'

const part = (overrides: Partial<ToolPart>): ToolPart => ({
  args: {},
  toolCallId: 'call_1',
  toolName: 'terminal',
  type: 'tool-call',
  ...overrides
})

afterEach(() => {
  setRuntimeI18nLocale('en')
})

describe('toolCardFamily, name and icon', () => {
  it.each([
    ['browser_navigate', 'browser', 'Browser', 'globe'],
    ['terminal', 'terminal', 'Terminal', 'terminal'],
    ['read_file', 'files', 'Files', 'file'],
    ['patch', 'files', 'Files', 'edit'],
    ['web_search', 'search', 'Search', 'search'],
    ['mcp__linear__create_issue', 'mcp', 'Linear', 'plug'],
    ['connectors__notion__search', 'mcp', 'Notion', 'plug'],
    ['memory', 'generic', 'Memory', 'brain'],
    ['calendar_lookup', 'generic', 'Calendar Lookup', 'tools']
  ])('%s is the %s family shown as "%s" with icon %s', (toolName, family, name, icon) => {
    const card = toolCardView(part({ toolName }))

    expect(toolCardFamily(toolName)).toBe(family)
    expect(card.family).toBe(family)
    expect(card.name).toBe(name)
    expect(card.icon).toBe(icon)
  })
})

describe('status wording and state', () => {
  const navigate = { url: 'https://example.com/docs' }

  it('reads present tense while running and past tense once settled', () => {
    const running = toolCardView(part({ args: navigate, toolName: 'browser_navigate' }))

    const done = toolCardView(
      part({
        args: navigate,
        result: { success: true, url: 'https://example.com/docs', title: 'Docs' },
        toolName: 'browser_navigate'
      })
    )

    expect(running.state).toBe('running')
    expect(running.status).toBe('Opening example.com/docs')
    expect(done.state).toBe('done')
    expect(done.status).toBe('Opened example.com/docs')
  })

  it('reports the reason from the first line of an error', () => {
    const card = toolCardView(part({ args: { path: '/workspace/app/out.txt' }, result: { error: 'disk full\nmore' }, toolName: 'write_file' }))

    expect(card.state).toBe('error')
    expect(card.reason).toBe('disk full')
  })

  it('settles an interrupted call as done and stopped', () => {
    const card = toolCardView(part({ args: navigate, completedAt: 1_700_000_000, interrupted: true, toolName: 'browser_navigate' }))

    expect(card.state).toBe('done')
    expect(card.status).toBe('Stopped')
  })

  it('waits for approval only while the call is running', () => {
    const pending = toolCardView(part({ args: { command: 'npm test' }, toolName: 'terminal' }), { approvalPending: true })

    const settled = toolCardView(
      part({ args: { command: 'npm test' }, result: { output: 'ok', exit_code: 0 }, toolName: 'terminal' }),
      { approvalPending: true }
    )

    expect(pending.state).toBe('approval')
    expect(settled.state).toBe('done')
  })

  it('converts second-based timestamps to ms epoch', () => {
    const card = toolCardView(part({ completedAt: 1_700_000_050, timestamp: 1_700_000_000 }))

    expect(card.startedAt).toBe(1_700_000_000_000)
    expect(card.completedAt).toBe(1_700_000_050_000)
  })
})

describe('thumbs', () => {
  it('shows the site a browser call was on', () => {
    const card = toolCardView(
      part({
        args: { url: 'https://example.com/docs' },
        result: { success: true, title: 'Docs', url: 'https://example.com/docs' },
        toolName: 'browser_navigate'
      })
    )

    expect(card.thumb).toEqual({ host: 'example.com', kind: 'site', url: 'https://example.com/docs' })
  })

  it('prefers a screenshot path the tool returned', () => {
    const card = toolCardView(
      part({
        args: { url: 'https://example.com/docs' },
        result: { success: true, screenshot_path: '/tmp/shot.png', url: 'https://example.com/docs' },
        toolName: 'browser_snapshot'
      })
    )

    expect(card.thumb).toEqual({ kind: 'screenshot', src: '/tmp/shot.png', url: 'https://example.com/docs' })
  })

  it('accepts an inline data image as a screenshot', () => {
    const src = 'data:image/png;base64,iVBORw0KGgo='
    const card = toolCardView(part({ result: { screenshot: src }, toolName: 'browser_snapshot' }))

    expect(card.thumb).toEqual({ kind: 'screenshot', src, url: undefined })
  })

  it('never gives a terminal call a thumb, even with a URL in its command', () => {
    const card = toolCardView(
      part({ args: { command: 'curl https://example.com' }, result: { output: 'ok', url: 'https://example.com' }, toolName: 'terminal' })
    )

    expect(card.thumb).toBeUndefined()
  })
})

describe('arguments and output', () => {
  it('summarises arguments as at most four plain rows', () => {
    const card = toolCardView(
      part({
        args: {
          command: 'npm test',
          headers: { accept: 'json' },
          max_results: 5,
          path: '/workspace/app',
          recursive: true,
          tags: ['a', 'b'],
          timeout: 30
        },
        toolName: 'terminal'
      })
    )

    expect(card.args.length).toBeLessThanOrEqual(4)
    expect(card.args[0]).toEqual({ label: 'Command', value: 'npm test' })
    expect(card.args.map(row => row.label)).toContain('Max results')

    for (const row of card.args) {
      expect(row.value).not.toContain('{')
    }
  })

  it('shows the output of an object result as text, not JSON', () => {
    const card = toolCardView(
      part({ result: { success: true, count: 2, nested: { deep: 1 } }, toolName: 'execute_code' })
    )

    expect(card.output).toBe('success: true\ncount: 2')
  })

  it('strips ANSI from a plain string result', () => {
    const card = toolCardView(part({ result: '\u001b[32mall passed\u001b[0m', toolName: 'terminal' }))

    expect(card.output).toBe('all passed')
  })
})

describe('grouping', () => {
  const browserDone = (index: number, screenshot?: string) =>
    part({
      args: { url: `https://example.com/page-${index}` },
      result: { success: true, title: `Page ${index}`, url: `https://example.com/page-${index}`, ...(screenshot ? { screenshot_path: screenshot } : {}) },
      toolCallId: `browser_${index}`,
      toolName: 'browser_navigate'
    })

  it('joins consecutive calls of one tool and keeps the latest screenshot', () => {
    const groups = toolCardsFromParts([browserDone(1, '/tmp/one.png'), browserDone(2), browserDone(3, '/tmp/three.png')])

    expect(groups).toHaveLength(1)
    expect(groups[0].cards).toHaveLength(3)
    expect(groups[0].thumb).toEqual({ kind: 'screenshot', src: '/tmp/three.png', url: 'https://example.com/page-3' })
  })

  it('splits a run when another tool intervenes', () => {
    const groups = toolCardsFromParts([
      browserDone(1),
      part({ args: { command: 'npm test' }, toolCallId: 'call_t', toolName: 'terminal' }),
      browserDone(2)
    ])

    expect(groups.map(group => group.name)).toEqual(['Browser', 'Terminal', 'Browser'])
  })

  it('gives an error its own group and ends the run before it', () => {
    const write = (toolCallId: string, result: unknown) =>
      part({ args: { path: '/workspace/app/notes.md' }, result, toolCallId, toolName: 'write_file' })

    const groups = toolCardsFromParts([write('a', { success: true }), write('b', { error: 'disk full' }), write('c', { success: true })])

    expect(groups).toHaveLength(3)
    expect(groups[1].state).toBe('error')
  })

  it('takes the state of the latest card in a group', () => {
    const groups = toolCardsFromParts([
      browserDone(1),
      part({ args: { url: 'https://example.com/page-2' }, toolCallId: 'browser_2', toolName: 'browser_navigate' })
    ])

    expect(groups).toHaveLength(1)
    expect(groups[0].state).toBe('running')
  })

  it('keeps key stable as the group grows', () => {
    const first = toolCardView(browserDone(1))
    const second = toolCardView(browserDone(2))

    expect(groupToolCards([first, second])[0].key).toBe(first.id)
  })
})

describe('toolCardsFromParts', () => {
  it('skips text parts and todo, and marks the call awaiting approval', () => {
    const groups = toolCardsFromParts(
      [
        { text: 'Let me check.', type: 'text' },
        part({ args: { items: [] }, toolCallId: 'call_todo', toolName: 'todo' }),
        part({ args: { command: 'npm test' }, toolCallId: 'call_run', toolName: 'terminal' })
      ],
      { approvalCallId: 'call_run' }
    )

    expect(groups).toHaveLength(1)
    expect(groups[0].cards.map(card => card.id)).toEqual(['call_run'])
    expect(groups[0].state).toBe('approval')
  })
})
