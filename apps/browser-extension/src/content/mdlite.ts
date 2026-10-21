/**
 * Markdown-lite + mention renderer for overlay message bodies.
 * Ported from OpenMausBot's transcript layer (Apache-2.0): the full
 * ChatMarkdown is a dependency-heavy renderer; this keeps the visible
 * subset a chat surface needs — fences, inline code, emphasis, links,
 * lists, quotes — and builds DOM nodes only (no innerHTML), so rendered
 * text can never inject markup.
 *
 * Mentions: `@name` where `name` matches a provided mention set (case-
 * insensitive) renders as a tinted pill with a deterministic per-name hue,
 * the way OpenMausBot's MentionColors assigns each peer a stable colour.
 *
 * An identical copy of this file lives in the desktop Bot Room engine
 * (apps/desktop/src/app/botroom/engine/mdlite.ts) — keep them in sync.
 */

export type Mentions = ReadonlySet<string>

function hashHue(name: string): number {
  let h = 0

  for (let i = 0; i < name.length; i++) {h = (h * 31 + name.charCodeAt(i)) | 0}

  return ((h % 360) + 360) % 360
}

export function mentionHue(name: string): number {
  return hashHue(name.trim().toLowerCase())
}

const INLINE_RE =
  /(`[^`\n]+`)|(\*\*[^*]+\*\*|__[^_]+__)|(\*[^*\n]+\*|_[^_\n]+_)|(~~[^~]+~~)|(\[[^\]\n]+\]\((https?:\/\/[^\s)]+|mailto:[^\s)]+)\))|(https?:\/\/[^\s<>"')]+)|@([A-Za-z0-9_.:-]+)|(\n)|(.)/g

function inlineAppend(text: string, out: Node, mentions?: Mentions, plain = false) {
  INLINE_RE.lastIndex = 0
  let m: RegExpExecArray | null

  while ((m = INLINE_RE.exec(text))) {
    const [whole, code, bold, italic, strike, linkMd, , bareUrl, atName, br, ch] = m
    // Mirror mode: markup stays literal text; only mention pills + breaks
    // still render, so the overlay wraps identically to the textarea.
    const lit = plain ? (code ?? bold ?? italic ?? strike ?? linkMd ?? bareUrl) : undefined

    if (lit !== undefined) {
      out.appendChild(document.createTextNode(lit))
    } else if (code) {
      const el = document.createElement('code')
      el.textContent = code.slice(1, -1)
      out.appendChild(el)
    } else if (bold) {
      const el = document.createElement('b')
      el.textContent = bold.slice(2, -2)
      out.appendChild(el)
    } else if (italic) {
      const el = document.createElement('i')
      el.textContent = italic.slice(1, -1)
      out.appendChild(el)
    } else if (strike) {
      const el = document.createElement('s')
      el.textContent = strike.slice(2, -2)
      out.appendChild(el)
    } else if (linkMd) {
      const a = document.createElement('a')
      const href = /https?:\/\/[^\s)]+|mailto:[^\s)]+/.exec(linkMd)?.[0] ?? ''
      a.href = href
      a.target = '_blank'
      a.rel = 'noopener noreferrer'
      a.textContent = linkMd.slice(1, linkMd.indexOf(']('))
      out.appendChild(a)
    } else if (bareUrl) {
      const a = document.createElement('a')
      a.href = bareUrl
      a.target = '_blank'
      a.rel = 'noopener noreferrer'
      a.textContent = bareUrl
      out.appendChild(a)
    } else if (atName && mentions?.has(atName.toLowerCase())) {
      const el = document.createElement('span')
      el.className = 'hr-mention'
      const hue = mentionHue(atName)
      el.style.setProperty('--mh', String(hue))
      el.textContent = `@${atName}`
      out.appendChild(el)
    } else if (br) {
      out.appendChild(document.createElement('br'))
    } else {
      out.appendChild(document.createTextNode(ch ?? whole))
    }
  }
}

/** Render message text into a fragment: block structure first (fences,
 *  lists, quotes, headings), inline markup inside each line. */
export function renderBody(text: string, mentions?: Mentions): DocumentFragment {
  const frag = document.createDocumentFragment()
  const lines = text.split('\n')
  let i = 0
  let para: HTMLElement | null = null

  const flushPara = () => {
    para = null
  }

  while (i < lines.length) {
    const line = lines[i]!

    if (line.startsWith('```')) {
      flushPara()
      const buf: string[] = []
      i += 1

      while (i < lines.length && !lines[i]!.startsWith('```')) {
        buf.push(lines[i]!)
        i += 1
      }

      i += 1

      const pre = document.createElement('pre')
      const codeEl = document.createElement('code')
      codeEl.textContent = buf.join('\n')
      pre.appendChild(codeEl)
      frag.appendChild(pre)

      continue
    }

    if (/^\s*([-*•])\s+/.test(line)) {
      flushPara()
      const ul = document.createElement('ul')
      ul.className = 'hr-ul'

      while (i < lines.length && /^\s*([-*•])\s+/.test(lines[i]!)) {
        const li = document.createElement('li')
        inlineAppend(lines[i]!.replace(/^\s*([-*•])\s+/, ''), li, mentions)
        ul.appendChild(li)
        i += 1
      }

      frag.appendChild(ul)

      continue
    }

    if (/^\s*\d+[.)]\s+/.test(line)) {
      flushPara()
      const ol = document.createElement('ol')
      ol.className = 'hr-ol'

      while (i < lines.length && /^\s*\d+[.)]\s+/.test(lines[i]!)) {
        const li = document.createElement('li')
        inlineAppend(lines[i]!.replace(/^\s*\d+[.)]\s+/, ''), li, mentions)
        ol.appendChild(li)
        i += 1
      }

      frag.appendChild(ol)

      continue
    }

    if (/^#{1,4}\s+/.test(line)) {
      flushPara()
      const el = document.createElement('div')
      el.className = 'hr-h'
      inlineAppend(line.replace(/^#{1,4}\s+/, ''), el, mentions)
      frag.appendChild(el)
      i += 1

      continue
    }

    if (/^>\s?/.test(line)) {
      flushPara()
      const el = document.createElement('blockquote')
      el.className = 'hr-quote'
      inlineAppend(line.replace(/^>\s?/, ''), el, mentions)
      frag.appendChild(el)
      i += 1

      continue
    }

    if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      flushPara()
      frag.appendChild(document.createElement('hr'))
      i += 1

      continue
    }

    if (!line.trim()) {
      flushPara()
      i += 1

      continue
    }

    // ordinary text: consecutive lines share one paragraph with <br>s
    if (!para) {
      para = document.createElement('div')
      para.className = 'hr-p'
      frag.appendChild(para)
    } else {
      para.appendChild(document.createElement('br'))
    }

    inlineAppend(line, para, mentions)
    i += 1
  }

  return frag
}

/** Mirror variant for the composer: no markdown, just the text with
 *  mention pills — has to wrap identically to the textarea it sits under. */
export function renderMirror(text: string, mentions?: Mentions): DocumentFragment {
  const frag = document.createDocumentFragment()
  inlineAppend(text, frag, mentions, true)

  return frag
}
