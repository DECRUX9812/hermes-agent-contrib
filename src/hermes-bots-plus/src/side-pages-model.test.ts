import { describe, expect, it } from 'vitest'

import { findPage, historyToMessages, pageFileName, pageFrameSrc, pagesFromMessages, pageTitle } from './side-pages-model'

const call = (toolName: string, args: Record<string, unknown>, toolCallId = toolName) => ({
  type: 'tool-call',
  toolCallId,
  toolName,
  args
})

describe('side pages model', () => {
  it('collects html, markdown and svg writes plus visualizations; latest write wins', () => {
    const pages = pagesFromMessages([
      { parts: [{ type: 'text', text: 'hi' }, call('write_file', { path: '/r/a.md', content: '# First\nx' }, 'c1')] },
      {
        parts: [
          call('write_file', { path: '/r/b.html', content: '<title>Plan &amp; dates</title><p>x</p>' }, 'c2'),
          call('write_file', { path: '/r/c.py', content: 'print(1)' }, 'c3'),
          call('write_file', { path: '/r/a.md', content: '# Second\ny' }, 'c4'),
          call('create_visualization', { title: 'Velocity', html: '<svg/>' }, 'c5')
        ]
      }
    ])

    expect(pages.map(p => [p.id, p.kind, p.title])).toEqual([
      ['/r/b.html', 'html', 'Plan & dates'],
      ['/r/a.md', 'markdown', 'Second'],
      ['visual:c5', 'html', 'Velocity']
    ])
  })

  it('reads argsText when args are missing and ignores empty content', () => {
    const pages = pagesFromMessages([
      { parts: [{ type: 'tool-call', toolName: 'write_file', argsText: '{"path":"v.svg","content":"<svg></svg>"}' }] },
      { parts: [call('write_file', { path: 'empty.md', content: '' })] }
    ])

    expect(pages.map(p => p.id)).toEqual(['v.svg'])
  })

  it('finds a page by exact path, then by unique file name', () => {
    const pages = pagesFromMessages([
      { parts: [call('write_file', { path: '/x/one.md', content: 'a' }, 'a'), call('write_file', { path: '/y/two.md', content: 'b' }, 'b')] }
    ])

    expect(findPage(pages, { path: '/x/one.md' })?.id).toBe('/x/one.md')
    expect(findPage(pages, { path: 'two.md' })?.id).toBe('/y/two.md')
    expect(findPage(pages, { path: 'nope.md' })).toBeNull()
  })

  it('titles, file names and frame urls', () => {
    expect(pageTitle('markdown', 'no heading', '/a/b/report.md')).toBe('report.md')
    expect(pageFileName({ content: '', id: 'v', kind: 'html', path: 'Velocity chart', title: '' })).toBe('Velocity chart.html')
    expect(pageFrameSrc({ content: '<b>x</b>', id: 'p', kind: 'svg', path: 'p.svg', title: '' })).toBe(
      'data:image/svg+xml;charset=utf-8,%3Cb%3Ex%3C%2Fb%3E'
    )
  })
})

describe('historyToMessages', () => {
  it('reads projected tool rows and raw tool_calls alike', () => {
    const pages = pagesFromMessages(
      historyToMessages([
        { role: 'user', text: 'make it' },
        { args: { content: '# Q3\nok', path: '/r/q3.md' }, name: 'write_file', role: 'tool', tool_call_id: 'a' },
        {
          role: 'assistant',
          tool_calls: [{ function: { arguments: JSON.stringify({ content: '<svg/>', path: 'c.svg' }), name: 'write_file' }, id: 'b' }]
        }
      ])
    )

    expect(pages.map(page => [page.kind, page.title])).toEqual([
      ['markdown', 'Q3'],
      ['svg', 'c.svg']
    ])
  })
})
