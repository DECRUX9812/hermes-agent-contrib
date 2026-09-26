import { describe, expect, it } from 'vitest'

import { frameSizeForDisplay, pickSourceForDisplay } from './region-capture'
import type { CaptureSource } from './region-capture'

const source = (displayId?: string): CaptureSource => ({
  display_id: displayId,
  thumbnail: { getSize: () => ({ height: 10, width: 10 }), isEmpty: () => false, toPNG: () => Buffer.from('') }
})

const display = (id: number, scaleFactor = 1): { id: number; scaleFactor: number; size: { height: number; width: number } } => ({
  id,
  scaleFactor,
  size: { height: 1440, width: 2560 }
})

describe('frameSizeForDisplay', () => {
  it('asks for native pixels (size × scaleFactor)', () => {
    expect(frameSizeForDisplay(display(1, 2))).toEqual({ height: 2880, width: 5120 })
    expect(frameSizeForDisplay(display(1, 1))).toEqual({ height: 1440, width: 2560 })
  })

  it('caps the edge so oversized captures do not blow up memory', () => {
    const size = frameSizeForDisplay({ id: 1, scaleFactor: 4, size: { height: 2160, width: 3840 } })

    expect(Math.max(size.width, size.height)).toBeLessThanOrEqual(8192)
  })
})

describe('pickSourceForDisplay', () => {
  it('prefers the source whose display_id matches the window display', () => {
    const sources = [source('1'), source('2')]

    expect(pickSourceForDisplay(sources, display(2), [display(1), display(2)])).toBe(sources[1])
  })

  it('falls back to the only source when ids are missing', () => {
    const sources = [source()]

    expect(pickSourceForDisplay(sources, display(2), [display(1), display(2)])).toBe(sources[0])
    expect(pickSourceForDisplay(sources, display(2), [display(1)])).toBe(sources[0])
  })

  it('refuses to guess when several sources match nothing', () => {
    const sources = [source('9'), source('8')]

    expect(pickSourceForDisplay(sources, display(2), [display(1), display(2)])).toBeUndefined()
    expect(pickSourceForDisplay([], display(1), [display(1)])).toBeUndefined()
  })
})
