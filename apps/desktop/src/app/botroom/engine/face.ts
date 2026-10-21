import { blobatar } from 'blobatar'

const textureCache = new Map<string, HTMLCanvasElement>()

/** Branded mascot art baked into the extension (icons/mascots/*.png).
 *  Keyed by preset bot name — the viral-trio harnesses get designed faces,
 *  everything else falls back to its deterministic blobatar. */
const BRAND_FACES: Record<string, string> = {
  Grok: 'grok',
  Grokbot: 'grok',
  Muse: 'muse',
  Scout: 'openai',
}

async function loadImage(src: string): Promise<HTMLImageElement> {
  const img = new Image()
  await new Promise<void>((resolve) => {
    img.onload = () => resolve()
    img.onerror = () => resolve()
    img.src = src
  })

  return img
}

/** Render a bot's face to a canvas for use as a mascot texture — branded art
 *  when the bot name maps to a preset, blobatar otherwise. */
export async function faceCanvas(name: string, size = 256): Promise<HTMLCanvasElement> {
  const key = `${name}:${size}`
  const hit = textureCache.get(key)

  if (hit) {return hit}

  const brand = BRAND_FACES[name]

  const img = brand
    ? await loadImage(`/botroom/${brand}.png`)
    : await loadImage('data:image/svg+xml;charset=utf-8,' + encodeURIComponent(blobatar(name, { size })))

  const c = document.createElement('canvas')
  c.width = c.height = size
  const ctx = c.getContext('2d')!
  ctx.drawImage(img, 0, 0, size, size)
  textureCache.set(key, c)

  return c
}

/** Small circular canvas avatar for DOM chips (rooms bar, panel head). */
export function faceDataUrl(name: string, size = 64): string {
  const svg = blobatar(name, { size })

  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg)
}
