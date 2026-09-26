import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { ArtifactRecord as TranscriptArtifact } from '@/app/artifacts/artifact-utils'
import { getAllSessionMessages } from '@/hermes'
import type { SessionInfo, SessionMessage } from '@/types/hermes'

import {
  $railArtifacts,
  $railItems,
  mergeRailArtifacts,
  refreshArtifactRail
} from './artifact-rail'
import { type ArtifactRecord, clearArtifactRegistry, upsertArtifact } from './artifacts'
import { $selectedStoredSessionId, setSessions } from './session'

vi.mock('@/hermes', async importOriginal => {
  const actual = (await importOriginal()) as Record<string, unknown>

  return { ...actual, getAllSessionMessages: vi.fn() }
})

const mockGetAll = vi.mocked(getAllSessionMessages)

const HTML_DETECTION = { kind: 'html' as const, language: 'html', title: 'Report' }

const session = (id: string, fields: Partial<SessionInfo> = {}) =>
  ({ id, input_tokens: 0, output_tokens: 0, started_at: 0, ...fields }) as SessionInfo

const registryRecord = (id: string, title = 'Report'): ArtifactRecord => ({
  createdAt: 1000,
  id,
  kind: 'html',
  language: 'html',
  sessionId: 's1',
  slug: 'html:html:report',
  title,
  updatedAt: 2000,
  versions: [{ content: '<html/>', createdAt: 1000, hash: 'h1' }]
})

const transcriptRecord = (id: string, fields: Partial<TranscriptArtifact> = {}): TranscriptArtifact => ({
  id,
  kind: 'file',
  value: '/tmp/out.md',
  href: 'file:///tmp/out.md',
  label: 'out.md',
  sessionId: 's1',
  sessionTitle: 'S1',
  timestamp: 1500,
  ...fields
})

beforeEach(() => {
  clearArtifactRegistry()
  $railArtifacts.set([])
  $selectedStoredSessionId.set(null)
  setSessions([])
  mockGetAll.mockReset()
})

describe('mergeRailArtifacts', () => {
  it('merges registry + transcript artifacts newest-first', () => {
    const items = mergeRailArtifacts(
      [registryRecord('s1:a'), { ...registryRecord('s1:b', 'Other'), updatedAt: 1200 }],
      [transcriptRecord('s1:/tmp/out.md')]
    )

    expect(items.map(item => item.id)).toEqual(['s1:a', 's1:/tmp/out.md', 's1:b'])
    expect(items[0]?.kind).toBe('artifact')
    expect(items[1]?.kind).toBe('file')
  })

  it('falls back to the slug when a registry artifact has no title', () => {
    const items = mergeRailArtifacts([{ ...registryRecord('s1:x'), title: '' }], [])

    expect(items[0]?.label).toBe('html:html:report')
  })
})

describe('$railItems', () => {
  it('lists registry artifacts for the focused session', () => {
    upsertArtifact('s1', HTML_DETECTION, '<html>v1</html>')
    $selectedStoredSessionId.set('s1')

    expect($railItems.get().map(item => item.id)).toEqual(['s1:html:html:report'])
  })

  it('resolves registry entries through lineage aliases', () => {
    upsertArtifact('s1', HTML_DETECTION, '<html>v1</html>')
    setSessions([session('s2', { _lineage_root_id: 's1' })])
    $selectedStoredSessionId.set('s2')

    expect($railItems.get().map(item => item.id)).toEqual(['s1:html:html:report'])
  })

  it('joins scraped transcript artifacts with registry records', () => {
    upsertArtifact('s1', HTML_DETECTION, '<html>v1</html>')
    $railArtifacts.set([transcriptRecord('s1:/tmp/out.md')])
    $selectedStoredSessionId.set('s1')

    expect($railItems.get().map(item => item.kind)).toEqual(['artifact', 'file'])
  })

  it('is empty when no session is focused', () => {
    upsertArtifact('s1', HTML_DETECTION, '<html>v1</html>')

    expect($railItems.get()).toEqual([])
  })
})

describe('refreshArtifactRail', () => {
  it('scrapes the focused session transcript and caches per session', async () => {
    setSessions([session('s1', { title: 'S1' })])
    $selectedStoredSessionId.set('s1')
    mockGetAll.mockResolvedValue({
      messages: [
        {
          content: 'Saved the chart to /tmp/chart.png',
          role: 'assistant',
          timestamp: 1_700_000_000
        } as SessionMessage
      ],
      session_id: 's1'
    })

    await refreshArtifactRail()

    expect($railArtifacts.get().map(artifact => artifact.value)).toEqual(['/tmp/chart.png'])

    await refreshArtifactRail()

    expect(mockGetAll).toHaveBeenCalledTimes(1)

    await refreshArtifactRail({ rescan: true })

    expect(mockGetAll).toHaveBeenCalledTimes(2)
  })

  it('clears the list and skips the fetch when no session is focused', async () => {
    await refreshArtifactRail()

    expect($railArtifacts.get()).toEqual([])
    expect(mockGetAll).not.toHaveBeenCalled()
  })

  it('degrades to registry-only when the transcript read fails', async () => {
    setSessions([session('s2')])
    $selectedStoredSessionId.set('s2')
    mockGetAll.mockRejectedValue(new Error('unreachable'))

    await refreshArtifactRail()

    expect($railArtifacts.get()).toEqual([])
  })
})
