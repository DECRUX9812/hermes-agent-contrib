import { blobatar } from 'blobatar'

const textureCache = new Map<string, HTMLCanvasElement>()

/** Render a bot's blobatar face to a canvas for use as a mascot texture. */
export async function faceCanvas(name: string, size = 256): Promise<HTMLCanvasElement> {
  const key = `${name}:${size}`
  const hit = textureCache.get(key)

  if (hit) {return hit}
  const svg = blobatar(name, { size })
  const img = new Image()
  const dataUrl = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg)
  await new Promise<void>((resolve) => {
    img.onload = () => resolve()
    img.onerror = () => resolve()
    img.src = dataUrl
  })
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
