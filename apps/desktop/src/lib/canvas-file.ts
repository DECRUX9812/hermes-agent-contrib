/**
 * `.excalidraw` files — the canvas's on-disk shape, shared by you and the
 * agent. Kept free of the (heavy, lazy) Excalidraw runtime so the parse/diff
 * rules are testable and cost nothing until a canvas actually opens.
 */

export interface CanvasElementLike {
  id: string
  isDeleted?: boolean
  version: number
}

export interface CanvasFileLike {
  id: string
}

export interface ParsedCanvas<E extends CanvasElementLike = any, F extends CanvasFileLike = any> {
  appState: Record<string, unknown>
  elements: E[]
  files: F[]
  filesById: Record<string, F>
}

export const CANVAS_EXTENSION = '.excalidraw'

export const isCanvasPath = (filePath: string) => filePath.toLowerCase().endsWith(CANVAS_EXTENSION)

/** A canvas file's scene; anything unreadable (an empty new file, a half-
 *  written save) is an empty canvas rather than an error. */
export function parseCanvas(text: string): ParsedCanvas {
  try {
    const data = JSON.parse(text || '{}') as { appState?: unknown; elements?: unknown; files?: unknown }
    const elements = Array.isArray(data.elements) ? data.elements : []
    const filesById = data.files && typeof data.files === 'object' ? (data.files as Record<string, CanvasFileLike>) : {}
    const appState = data.appState && typeof data.appState === 'object' ? (data.appState as Record<string, unknown>) : {}

    return { appState, elements, files: Object.values(filesById), filesById }
  } catch {
    return { appState: {}, elements: [], files: [], filesById: {} }
  }
}

/** Identity of a scene's CONTENT: which live elements exist at which version.
 *  Viewport moves, selection and tool changes leave it alone, so they never
 *  trigger a save; any stroke, move or edit bumps an element's version. */
export function sceneKey(elements: readonly CanvasElementLike[]): string {
  return elements
    .filter(element => !element.isDeleted)
    .map(element => `${element.id}:${element.version}`)
    .sort()
    .join('|')
}

/** An empty canvas file, ready to open. */
export function emptyCanvasFile(): string {
  return JSON.stringify(
    { type: 'excalidraw', version: 2, source: 'hermes-desktop', elements: [], appState: {}, files: {} },
    null,
    2
  )
}

/** The first free `canvas.excalidraw`, `canvas-2.excalidraw`, … in a folder. */
export function nextCanvasName(existing: readonly string[]): string {
  const taken = new Set(existing.map(name => name.toLowerCase()))

  for (let n = 1; ; n++) {
    const name = n === 1 ? `canvas${CANVAS_EXTENSION}` : `canvas-${n}${CANVAS_EXTENSION}`

    if (!taken.has(name)) {
      return name
    }
  }
}
