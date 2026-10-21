import { afterEach, describe, expect, it, vi } from 'vitest'

import { clearSessionDraft, takeSessionDraft } from '@/store/composer'

import type { DroppedFile } from './hooks/use-composer-actions'
import { stageDroppedFilesForSession } from './session-drop-attach'

const CWD = '/work/project'
const inAppRef = (path: string, extra: Partial<DroppedFile> = {}): DroppedFile => ({ path, ...extra })

const osDrop = (path: string, type = 'application/pdf'): DroppedFile => ({
  file: new File(['x'], path.split('/').pop() || 'f', { type }),
  path
})

afterEach(() => {
  clearSessionDraft('session-a')
  window.localStorage.clear()
  Reflect.deleteProperty(window, 'hermesDesktop')
})

describe('stageDroppedFilesForSession', () => {
  it('stages a file-tree drop as an @file: chip under the session draft', async () => {
    const count = await stageDroppedFilesForSession('session-a', [inAppRef('src/index.ts')], CWD)

    expect(count).toBe(1)
    const [chip] = takeSessionDraft('session-a').attachments
    expect(chip?.kind).toBe('file')
    expect(chip?.refText).toBe('@file:src/index.ts')
    expect(chip?.label).toBe('index.ts')
    expect(chip?.path).toBe('src/index.ts')
  })

  it('stages folder, line-range, and link refs with the same chip kinds a composer drop makes', async () => {
    const count = await stageDroppedFilesForSession(
      'session-a',
      [
        inAppRef('src/lib', { isDirectory: true }),
        inAppRef('src/app.ts', { line: 10, lineEnd: 20 }),
        inAppRef('', { url: 'https://nousresearch.com/spec' })
      ],
      CWD
    )

    expect(count).toBe(3)
    const [folder, line, url] = takeSessionDraft('session-a').attachments
    expect(folder?.kind).toBe('folder')
    expect(folder?.refText).toBe('@folder:src/lib')
    expect(line?.refText).toBe('@line:src/app.ts:10-20')
    expect(line?.label).toBe('app.ts:10-20')
    expect(url?.kind).toBe('url')
    expect(url?.refText).toBe('@url:https://nousresearch.com/spec')
  })

  it('runs OS image drops through the durable saveImageBuffer path, not the temp drop path', async () => {
    const saveImageBuffer = vi.fn(async () => '/cache/composer-images/shot.png')
    Object.defineProperty(window, 'hermesDesktop', { configurable: true, value: { saveImageBuffer } })

    const count = await stageDroppedFilesForSession(
      'session-a',
      [osDrop('/var/folders/tmp/Screenshot 2026-09-26.png', 'image/png')],
      CWD
    )

    expect(count).toBe(1)
    const [chip] = takeSessionDraft('session-a').attachments
    expect(chip?.kind).toBe('image')
    expect(chip?.path).toBe('/cache/composer-images/shot.png')
    expect(chip?.occurrenceId).toBeTruthy()
    expect(saveImageBuffer).toHaveBeenCalledOnce()
  })

  it('stages a plain OS file drop as an @file: chip on the drop path', async () => {
    Object.defineProperty(window, 'hermesDesktop', {
      configurable: true,
      value: { getPathForFile: () => '/outside/downloads/report.pdf' }
    })
    const file = new File(['x'], 'report.pdf', { type: 'application/pdf' })

    const count = await stageDroppedFilesForSession('session-a', [{ file, path: '' }], CWD)

    expect(count).toBe(1)
    const [chip] = takeSessionDraft('session-a').attachments
    expect(chip?.kind).toBe('file')
    expect(chip?.path).toBe('/outside/downloads/report.pdf')
    expect(chip?.refText).toBe('@file:/outside/downloads/report.pdf')
  })

  it('returns 0 without touching the draft when nothing could be attached', async () => {
    Object.defineProperty(window, 'hermesDesktop', { configurable: true, value: {} })
    const file = new File(['x'], 'mystery.bin', { type: 'application/octet-stream' })

    const count = await stageDroppedFilesForSession('session-a', [{ file, path: '' }], CWD)

    expect(count).toBe(0)
    expect(takeSessionDraft('session-a').attachments).toEqual([])
  })
})
