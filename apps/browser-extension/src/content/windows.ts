/**
 * Overlay windows — bots open floating panes on the page: small "thought"
 * cards for short replies, medium preview panes (YouTube embed, page
 * excerpts), expandable to full-screen. When a window is full, mascots
 * edge-dock so the content owns the screen.
 */

export type WindowKind = 'thought' | 'embed' | 'html' | 'feed' | 'search'
export type WindowSize = 'sm' | 'md' | 'lg' | 'full'

export interface FeedItem {
  title: string
  subtitle?: string
  image?: string
  url?: string
  badge?: string
}

export interface WindowSpec {
  id?: string
  title?: string
  kind?: WindowKind
  /** embed/url kind: the URL. html kind: HTML string. thought: text. */
  content?: string
  url?: string
  /** feed kind: items to render as a vertical card feed. */
  items?: FeedItem[]
  /** search kind: placeholder + callback wiring happens via onSearch message. */
  placeholder?: string
  size?: WindowSize
}

const SIZES: Record<Exclude<WindowSize, 'full'>, { w: number; h: number }> = {
  sm: { w: 300, h: 170 },
  md: { w: 520, h: 330 },
  lg: { w: 760, h: 480 },
}

export class WindowManager {
  // Windows must sit above every other overlay layer — the class stylesheet
  // gives hr-window 2147483643 but the inline stacking counter replaces it,
  // so it has to start above the mascot hit rects (2147483642) and dropzone.
  private zTop = 2147483644
  private windows = new Map<string, { el: HTMLElement; size: WindowSize; restore?: string }>()
  onFullscreen: ((full: boolean) => void) | null = null
  /** Feed-card click → stage decides (default: open url in window or tab). */
  onCard: ((windowId: string, item: FeedItem) => void) | null = null
  /** Search widget submit → stage forwards to the bot that opened it. */
  onSearch: ((windowId: string, query: string, resultsEl: HTMLElement) => void) | null = null

  constructor(private root: ShadowRoot) {}

  open(spec: WindowSpec): string {
    const id = spec.id ?? `w${Date.now().toString(36)}`
    const existing = this.windows.get(id)

    if (existing) {
      existing.el.remove()
      this.windows.delete(id)
    }

    const size = spec.size ?? 'md'
    const el = document.createElement('div')
    el.className = `hr-window hr-win-${size}`
    el.innerHTML = `
      <div class="hr-win-head">
        <span class="hr-win-dots">
          <button class="hr-win-btn" data-a="close" data-g="✕" title="Close"></button>
          <button class="hr-win-btn" data-a="shrink" data-g="–" title="Smaller"></button>
          <button class="hr-win-btn" data-a="grow" data-g="+" title="Bigger"></button>
          <button class="hr-win-btn" data-a="full" data-g="⤢" title="Full screen"></button>
        </span>
        <span class="hr-win-title"></span>
      </div>
      <div class="hr-win-body"></div>
      <div class="hr-resize" title="Resize"></div>`
    el.querySelector('.hr-win-title')!.textContent = spec.title ?? 'Bot Room'

    const body = el.querySelector('.hr-win-body')!
    const kind = spec.kind ?? (spec.url ? 'embed' : 'thought')

    if (kind === 'thought') {
      const p = document.createElement('div')
      p.className = 'hr-thought'
      p.textContent = spec.content ?? ''
      body.appendChild(p)
    } else if (kind === 'embed') {
      const f = document.createElement('iframe')
      f.src = spec.url ?? spec.content ?? ''
      f.setAttribute('allow', 'autoplay; encrypted-media; picture-in-picture')
      f.setAttribute('allowfullscreen', 'true')
      body.appendChild(f)
    } else if (kind === 'feed') {
      const feed = document.createElement('div')
      feed.className = 'hr-feed'

      for (const item of spec.items ?? []) {
        const card = document.createElement('div')
        card.className = 'hr-card'

        const thumb = document.createElement('span')
        thumb.className = 'hr-thumb'
        thumb.textContent = '▶'

        if (item.image) {
          const img = document.createElement('img')
          img.src = item.image
          img.loading = 'lazy'
          img.onerror = () => img.remove()
          thumb.appendChild(img)
        }
        card.appendChild(thumb)

        const txt = document.createElement('div')
        txt.className = 'hr-card-txt'
        const t = document.createElement('div')
        t.className = 'hr-card-title'
        t.textContent = item.title
        txt.appendChild(t)

        if (item.subtitle) {
          const s = document.createElement('div')
          s.className = 'hr-card-sub'
          s.textContent = item.subtitle
          txt.appendChild(s)
        }

        card.appendChild(txt)

        if (item.badge) {
          const b = document.createElement('span')
          b.className = 'hr-card-badge'
          b.textContent = item.badge
          card.appendChild(b)
        }

        if (item.url) {
          card.style.cursor = 'pointer'
          card.addEventListener('click', () => this.onCard?.(id, item))
        }

        feed.appendChild(card)
      }

      body.appendChild(feed)
    } else if (kind === 'search') {
      const wrap = document.createElement('div')
      wrap.className = 'hr-search'
      const input = document.createElement('input')
      input.placeholder = spec.placeholder ?? 'Search…'
      const results = document.createElement('div')
      results.className = 'hr-search-results'
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && input.value.trim()) {
          this.onSearch?.(id, input.value.trim(), results)
        }
      })
      wrap.appendChild(input)
      wrap.appendChild(results)
      body.appendChild(wrap)
    } else {
      const wrap = document.createElement('div')
      wrap.className = 'hr-html'
      wrap.innerHTML = spec.content ?? ''
      body.appendChild(wrap)
    }

    // position cascade
    const n = this.windows.size
    const s = SIZES[size === 'full' ? 'lg' : size]
    el.style.width = size === 'full' ? 'calc(100vw - 32px)' : `${s.w}px`
    el.style.height = size === 'full' ? 'calc(100vh - 32px)' : `${s.h}px`
    el.style.left = size === 'full' ? '16px' : `${Math.max(16, innerWidth - s.w - 40 - (n % 4) * 26)}px`
    el.style.top = size === 'full' ? '16px' : `${90 + (n % 5) * 26}px`
    el.style.zIndex = String(this.zTop++)

    if (size === 'full') {this.setFull(el, true)}

    // drag by titlebar
    const head = el.querySelector('.hr-win-head') as HTMLElement
    let dx = 0
    let dy = 0
    let dragging = false
    head.addEventListener('pointerdown', (e) => {
      if ((e.target as HTMLElement).closest('.hr-win-btn')) {return}
      dragging = true
      dx = e.clientX - el.offsetLeft
      dy = e.clientY - el.offsetTop
      head.setPointerCapture(e.pointerId)
      el.style.zIndex = String(this.zTop++)
    })
    head.addEventListener('pointermove', (e) => {
      if (!dragging) {return}
      el.style.left = `${Math.max(0, Math.min(innerWidth - 60, e.clientX - dx))}px`
      el.style.top = `${Math.max(0, Math.min(innerHeight - 40, e.clientY - dy))}px`
    })
    head.addEventListener('pointerup', () => {
      dragging = false
    })
    head.addEventListener('pointercancel', () => {
      dragging = false
    })

    el.addEventListener('pointerdown', () => {
      el.style.zIndex = String(this.zTop++)
    })
    el.addEventListener('click', (e) => {
      const a = (e.target as HTMLElement).closest<HTMLElement>('.hr-win-btn')?.dataset.a

      if (a === 'close') {this.close(id)}
      else if (a === 'full') {this.setFull(el, !el.classList.contains('hr-win-full'))}
      else if (a === 'grow') {this.cycle(el, id, 1)}
      else if (a === 'shrink') {this.cycle(el, id, -1)}
    })

    // corner resize grip — freeform, floored at the sm preset
    const grip = el.querySelector('.hr-resize') as HTMLElement
    let rw = 0
    let rh = 0
    let rx = 0
    let ry = 0
    let resizing = false
    grip.addEventListener('pointerdown', (e) => {
      resizing = true
      rx = e.clientX
      ry = e.clientY
      rw = el.offsetWidth
      rh = el.offsetHeight
      grip.setPointerCapture(e.pointerId)
      e.stopPropagation()
    })
    grip.addEventListener('pointermove', (e) => {
      if (!resizing) {return}
      el.style.width = `${Math.max(220, rw + e.clientX - rx)}px`
      el.style.height = `${Math.max(120, rh + e.clientY - ry)}px`
    })
    grip.addEventListener('pointerup', () => {
      resizing = false
    })
    grip.addEventListener('pointercancel', () => {
      resizing = false
    })

    this.root.appendChild(el)
    this.windows.set(id, { el, size })

    return id
  }

  private cycle(el: HTMLElement, id: string, dir: 1 | -1) {
    const order: ('sm' | 'md' | 'lg')[] = ['sm', 'md', 'lg']
    const cur = this.windows.get(id)

    if (!cur || cur.size === 'full') {return}
    const next = order[Math.max(0, Math.min(order.length - 1, order.indexOf(cur.size as 'sm' | 'md' | 'lg') + dir))]!
    cur.size = next
    const s = SIZES[next]
    el.style.width = `${s.w}px`
    el.style.height = `${s.h}px`
    el.className = `hr-window hr-win-${next}`
  }

  private setFull(el: HTMLElement, full: boolean) {
    el.classList.toggle('hr-win-full', full)

    if (full) {
      el.dataset.restoreW = el.style.width
      el.dataset.restoreH = el.style.height
      el.dataset.restoreL = el.style.left
      el.dataset.restoreT = el.style.top
      el.style.left = '16px'
      el.style.top = '16px'
      el.style.width = 'calc(100vw - 32px)'
      el.style.height = 'calc(100vh - 32px)'
    } else {
      el.style.width = el.dataset.restoreW ?? ''
      el.style.height = el.dataset.restoreH ?? ''
      el.style.left = el.dataset.restoreL ?? ''
      el.style.top = el.dataset.restoreT ?? ''
    }

    this.onFullscreen?.(full)
  }

  close(id: string) {
    const w = this.windows.get(id)

    if (!w) {return}
    const wasFull = w.el.classList.contains('hr-win-full')
    w.el.remove()
    this.windows.delete(id)

    if (wasFull) {this.onFullscreen?.(false)}
  }

  isFullscreenOpen(): boolean {
    for (const w of this.windows.values()) {
      if (w.el.classList.contains('hr-win-full')) {return true}
    }

    return false
  }
}
