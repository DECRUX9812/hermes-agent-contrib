/**
 * The canvas saves only when the drawing itself changes (never on open, pan
 * or select), reads any file — even a half-written one — as a scene, and never
 * names a new canvas over an existing one.
 */

import { describe, expect, it } from 'vitest'

import { emptyCanvasFile, nextCanvasName, parseCanvas, sceneKey } from './canvas-file'

describe('canvas files', () => {
  it('keys a scene by its live content only', () => {
    const a = [
      { id: 'r1', version: 3 },
      { id: 't1', version: 1 }
    ]

    // Order and deleted elements don't change what is drawn; a new version does.
    expect(sceneKey([...a].reverse())).toBe(sceneKey(a))
    expect(sceneKey([...a, { id: 'x', isDeleted: true, version: 9 }])).toBe(sceneKey(a))
    expect(sceneKey([{ ...a[0], version: 4 }, a[1]])).not.toBe(sceneKey(a))
  })

  it('parses any text as a scene and names new canvases without collisions', () => {
    expect(parseCanvas('{"elements": [{"id": "r1", "version": 1}]').elements).toEqual([])
    expect(parseCanvas(emptyCanvasFile()).elements).toEqual([])
    expect(nextCanvasName(['notes.md'])).toBe('canvas.excalidraw')
    expect(nextCanvasName(['Canvas.excalidraw', 'canvas-2.excalidraw'])).toBe('canvas-3.excalidraw')
  })
})
