/**
 * A bot's shareable profile card — the picture you paste into a chat, a doc or
 * a store window: its face, name, role, what it does, what to ask it, and (when
 * it has one) the QR that opens a conversation with it. Drawn on a canvas so it
 * leaves the app as a plain PNG that renders anywhere.
 */

export interface ShareCardData {
  accent: string
  description: string
  /** Rasterisable face: a data/blob URL of the bot's SVG face or photo. */
  faceUrl: null | string
  footer: string
  name: string
  /** QR data URL for the bot's messaging address, when it has one. */
  qrUrl: null | string
  qrCaption: string
  role: string
  starters: string[]
  startersLabel: string
}

export const SHARE_CARD_WIDTH = 1200
export const SHARE_CARD_HEIGHT = 630

/** Greedy word wrap to `maxLines`, ellipsising the last line when text is left
 *  over. `measure` is injected so the layout is testable without a canvas. */
export function wrapText(text: string, maxWidth: number, maxLines: number, measure: (s: string) => number): string[] {
  const words = text.trim().split(/\s+/).filter(Boolean)
  const lines: string[] = []
  let line = ''
  let index = 0

  for (; index < words.length; index++) {
    const next = line ? `${line} ${words[index]}` : words[index]

    if (measure(next) <= maxWidth || !line) {
      line = next

      continue
    }

    lines.push(line)
    line = words[index]

    if (lines.length === maxLines) {
      break
    }
  }

  if (lines.length < maxLines && line) {
    lines.push(line)
    index = words.length
  }

  if (index < words.length && lines.length) {
    let last = lines[lines.length - 1]

    while (last && measure(`${last}…`) > maxWidth) {
      last = last.slice(0, -1)
    }

    lines[lines.length - 1] = `${last.trimEnd()}…`
  }

  return lines
}

/** The invite someone pastes: who the bot is, what it does, and how to reach it. */
export function inviteText({
  description,
  link,
  name,
  role
}: {
  description: string
  link: null | string
  name: string
  role: string
}): string {
  return [role ? `${name} · ${role}` : name, description.trim(), link ? link : ''].filter(Boolean).join('\n')
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = reject
    img.src = url
  })
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}

const FONT = '"Inter", "SF Pro Display", "Segoe UI", system-ui, sans-serif'

/** Paint the card into a fresh canvas (2× for crisp pasting) and return it. */
export async function drawShareCard(data: ShareCardData): Promise<HTMLCanvasElement> {
  const scale = 2
  const W = SHARE_CARD_WIDTH
  const H = SHARE_CARD_HEIGHT
  const canvas = document.createElement('canvas')
  canvas.width = W * scale
  canvas.height = H * scale
  const ctx = canvas.getContext('2d')

  if (!ctx) {
    return canvas
  }

  ctx.scale(scale, scale)

  // Paper: warm white with a wash of the bot's own colour from the left.
  ctx.fillStyle = '#fbfaf8'
  ctx.fillRect(0, 0, W, H)
  const wash = ctx.createRadialGradient(260, 300, 20, 260, 300, 620)
  wash.addColorStop(0, `${data.accent}33`)
  wash.addColorStop(1, `${data.accent}00`)
  ctx.fillStyle = wash
  ctx.fillRect(0, 0, W, H)

  // The character, on a floor shadow.
  const faceSize = 260
  const faceX = 130
  const faceY = 150
  // An elliptical floor shadow: a radial gradient in a squashed space.
  ctx.save()
  ctx.translate(faceX + faceSize / 2, faceY + faceSize + 22)
  ctx.scale(1, 0.18)
  const floor = ctx.createRadialGradient(0, 0, 0, 0, 0, faceSize * 0.5)
  floor.addColorStop(0, 'rgba(0,0,0,0.22)')
  floor.addColorStop(1, 'rgba(0,0,0,0)')
  ctx.fillStyle = floor
  ctx.beginPath()
  ctx.arc(0, 0, faceSize * 0.5, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()

  if (data.faceUrl) {
    try {
      const face = await loadImage(data.faceUrl)
      // Photos and pets are square and get rounded corners; a math face is
      // its own silhouette (transparent around it) at its natural 40:44.
      const vector = data.faceUrl.startsWith('data:image/svg')
      const faceH = vector && face.naturalWidth ? (faceSize * face.naturalHeight) / face.naturalWidth : faceSize
      ctx.save()

      if (!vector) {
        roundRect(ctx, faceX, faceY, faceSize, faceSize, 48)
        ctx.clip()
      }

      ctx.drawImage(face, faceX, faceY + faceSize - faceH, faceSize, faceH)
      ctx.restore()
    } catch {
      // A face that won't rasterise leaves the wash — the name still carries it.
    }
  }

  // Words.
  const textX = 480
  const qrSize = data.qrUrl ? 150 : 0
  const textW = W - textX - 72
  ctx.textBaseline = 'alphabetic'
  ctx.fillStyle = '#16161a'
  ctx.font = `700 64px ${FONT}`
  ctx.fillText(data.name, textX, 190, textW)

  let y = 190

  if (data.role) {
    y += 48
    ctx.fillStyle = data.accent
    ctx.font = `600 28px ${FONT}`
    ctx.fillText(data.role, textX, y, textW)
  }

  if (data.description) {
    ctx.fillStyle = '#4a4a55'
    ctx.font = `400 26px ${FONT}`

    for (const line of wrapText(data.description, textW, 3, s => ctx.measureText(s).width)) {
      y += 40
      ctx.fillText(line, textX, y)
    }
  }

  if (data.starters.length) {
    y += 56
    ctx.fillStyle = '#8a8a96'
    ctx.font = `600 20px ${FONT}`
    ctx.fillText(data.startersLabel, textX, y)
    ctx.font = `500 22px ${FONT}`
    y += 14

    for (const starter of data.starters.slice(0, 2)) {
      const label = wrapText(`“${starter}”`, textW - qrSize - 40, 1, s => ctx.measureText(s).width)[0] ?? ''
      const pillW = Math.min(textW - qrSize - 16, ctx.measureText(label).width + 36)
      y += 14
      ctx.fillStyle = '#ffffff'
      roundRect(ctx, textX, y, pillW, 44, 22)
      ctx.fill()
      ctx.strokeStyle = 'rgba(0,0,0,0.08)'
      ctx.lineWidth = 1
      ctx.stroke()
      ctx.fillStyle = '#2a2a33'
      ctx.fillText(label, textX + 18, y + 29)
      y += 44
    }
  }

  if (data.qrUrl) {
    try {
      const qr = await loadImage(data.qrUrl)
      const qx = W - 72 - qrSize
      const qy = H - 72 - qrSize - 28
      ctx.fillStyle = '#ffffff'
      roundRect(ctx, qx - 10, qy - 10, qrSize + 20, qrSize + 20, 16)
      ctx.fill()
      ctx.drawImage(qr, qx, qy, qrSize, qrSize)
      ctx.fillStyle = '#6a6a75'
      ctx.font = `500 16px ${FONT}`
      ctx.textAlign = 'center'
      ctx.fillText(data.qrCaption, qx + qrSize / 2, qy + qrSize + 34)
      ctx.textAlign = 'left'
    } catch {
      // No QR drawn — the invite text still carries the link.
    }
  }

  ctx.fillStyle = '#a0a0aa'
  ctx.font = `500 18px ${FONT}`
  ctx.fillText(data.footer, 72, H - 48)

  return canvas
}

/** Serialise a live SVG face into a data URL a canvas can draw. */
export function svgFaceUrl(svg: SVGSVGElement | null): null | string {
  if (!svg) {
    return null
  }

  const clone = svg.cloneNode(true) as SVGSVGElement
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
  clone.setAttribute('width', '400')
  clone.setAttribute('height', '440')

  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(new XMLSerializer().serializeToString(clone))}`
}
