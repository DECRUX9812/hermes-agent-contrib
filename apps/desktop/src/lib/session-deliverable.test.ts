import { describe, expect, it } from 'vitest'

import type { ArtifactRecord as TranscriptArtifact } from '@/app/artifacts/artifact-utils'
import type { ArtifactRecord } from '@/store/artifacts'

import { deliverableMarkdown } from './session-deliverable'

const registryArtifact: ArtifactRecord = {
  createdAt: 1000,
  id: 's1:html:html:report',
  kind: 'html',
  language: 'html',
  sessionId: 's1',
  slug: 'html:html:report',
  title: 'Report',
  updatedAt: 2000,
  versions: [{ content: '<html/>', createdAt: 1000, hash: 'h1' }]
}

const transcriptArtifact: TranscriptArtifact = {
  href: 'file:///tmp/out.png',
  id: 's1:/tmp/out.png',
  kind: 'image',
  label: 'out.png',
  sessionId: 's1',
  sessionTitle: 'Fix bug',
  timestamp: 1500,
  value: '/tmp/out.png'
}

const base = {
  artifacts: [] as ArtifactRecord[],
  files: [] as { added: null | number; path: string; removed: null | number }[],
  pr: null,
  sessionId: 's1',
  summary: 'Fixed the bug in foo.ts.',
  title: 'Fix bug',
  transcriptArtifacts: [] as TranscriptArtifact[]
}

describe('deliverableMarkdown', () => {
  it('renders title, session id and summary', () => {
    const md = deliverableMarkdown(base)

    expect(md).toContain('# Fix bug')
    expect(md).toContain('- Session: `s1`')
    expect(md).toContain('## Summary')
    expect(md).toContain('Fixed the bug in foo.ts.')
    expect(md.endsWith('\n')).toBe(true)
  })

  it('omits optional sections when empty', () => {
    const md = deliverableMarkdown(base)

    expect(md).not.toContain('## Changes')
    expect(md).not.toContain('## Artifacts')
    expect(md).not.toContain('## Pull request')
  })

  it('renders the diff stat with per-file rows', () => {
    const md = deliverableMarkdown({
      ...base,
      files: [
        { added: 10, path: 'src/a.ts', removed: 2 },
        { added: null, path: 'src/b.ts', removed: null }
      ]
    })

    expect(md).toContain('## Changes')
    expect(md).toContain('2 files touched')
    expect(md).toContain('- `src/a.ts` (+10 −2)')
    expect(md).toContain('- `src/b.ts`')
    expect(md).not.toContain('src/b.ts` (')
  })

  it('renders registry and transcript artifacts', () => {
    const md = deliverableMarkdown({
      ...base,
      artifacts: [registryArtifact],
      transcriptArtifacts: [transcriptArtifact]
    })

    expect(md).toContain('## Artifacts')
    expect(md).toContain('- `html` — Report')
    expect(md).toContain('- `image` — out.png (`file:///tmp/out.png`)')
  })

  it('renders the PR link when present', () => {
    const md = deliverableMarkdown({
      ...base,
      pr: { number: 42, state: 'open', title: 'Fix bug', url: 'https://github.com/o/r/pull/42' }
    })

    expect(md).toContain('## Pull request')
    expect(md).toContain('[#42 Fix bug](https://github.com/o/r/pull/42) — open')
  })

  it('falls back to the no-summary notice', () => {
    expect(deliverableMarkdown({ ...base, summary: '' })).toContain('*No assistant reply recorded*')
  })
})
