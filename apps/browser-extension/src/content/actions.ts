/**
 * Page actions executed inside the tab. The vocabulary mirrors Hermes'
 * browser.controller allowlist plus dom_* and compose, so the same command
 * works whether it arrives from a Hermes bot or a generic harness.
 */

import type { WindowManager } from './windows'

/** The stage registers its WindowManager so `window.*` actions open panes. */
let wm: WindowManager | null = null

export function setWindowManager(m: WindowManager) {
  wm = m
}

interface ActionArgs {
  selector?: string
  text?: string
  x?: number
  y?: number
  url?: string
  key?: string
  dx?: number
  dy?: number
  html?: string
  css?: Record<string, string>
  position?: 'before' | 'after' | 'inside-start' | 'inside-end'
  mode?: 'replace' | 'append' | 'typewrite'
  ms?: number
  label?: string
  tabId?: number
  [k: string]: unknown
}

export function uniqueSelector(el: Element): string {
  if (el.id) {return `#${CSS.escape(el.id)}`}
  const parts: string[] = []
  let cur: Element | null = el

  for (let i = 0; i < 6 && cur && cur !== document.documentElement; i++) {
    let part = cur.localName
    const cls = [...cur.classList].filter((c) => !/^(hr-|hover|active|focus|open|show)/i.test(c)).slice(0, 2)

    if (cls.length) {part += '.' + cls.map((c) => CSS.escape(c)).join('.')}
    const parent: Element | null = cur.parentElement

    if (parent) {
      const same = [...parent.children].filter((c) => c.localName === cur!.localName)

      if (same.length > 1) {part += `:nth-of-type(${same.indexOf(cur) + 1})`}
    }

    parts.unshift(part)
    cur = parent
  }

  return parts.join(' > ')
}

function findElement(a: ActionArgs): Element | null {
  if (a.selector) {
    try {
      return document.querySelector(a.selector)
    } catch {
      return null
    }
  }

  if (typeof a.x === 'number' && typeof a.y === 'number') {
    return document.elementFromPoint(a.x, a.y)
  }

  if (a.text) {
    const needle = a.text.trim().toLowerCase()

    const cand = document.querySelectorAll(
      'a,button,[role=button],[role=link],input,textarea,[contenteditable],h1,h2,h3,h4,p,span,div,li'
    )

    let best: Element | null = null
    let bestScore = Infinity

    for (const el of cand) {
      const t = (el.textContent ?? '').trim().toLowerCase()

      if (!t) {continue}

      if (t === needle) {return el}

      if (t.includes(needle)) {
        const score = t.length

        if (score < bestScore) {
          bestScore = score
          best = el
        }
      }

      const aria = el.getAttribute('aria-label')?.toLowerCase()

      if (aria && aria.includes(needle)) {return el}
    }

    return best
  }

  return null
}

function describe(el: Element | null): string {
  if (!el) {return '∅'}
  const rect = el.getBoundingClientRect()
  const t = (el.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 60)

  return `${el.localName}${el.id ? '#' + el.id : ''} "${t}" @${Math.round(rect.x)},${Math.round(rect.y)}`
}

function setValue(el: Element, text: string) {
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    const proto = el instanceof HTMLInputElement ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype
    const desc = Object.getOwnPropertyDescriptor(proto, 'value')
    desc?.set?.call(el, text)
    el.dispatchEvent(new Event('input', { bubbles: true }))
    el.dispatchEvent(new Event('change', { bubbles: true }))
  } else if (el instanceof HTMLElement && el.isContentEditable) {
    el.focus()
    el.innerText = text
    el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }))
    el.dispatchEvent(new Event('change', { bubbles: true }))
  }
}

async function typeInto(el: Element, text: string, append: boolean) {
  const target = (el as HTMLElement).isContentEditable || el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement
    ? el
    : el.querySelector('input,textarea,[contenteditable]') ?? el

  ;(target as HTMLElement).focus()

  const cur =
    target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement
      ? target.value
      : (target as HTMLElement).innerText ?? ''

  const next = append ? cur + text : text
  setValue(target, next)
}

export async function runPageAction(action: string, a: ActionArgs): Promise<unknown> {
  // Hermes sends browser_-prefixed names; harnesses send short names — same verb.
  if (action.startsWith('browser_')) {action = action.slice(8)}

  switch (action) {
    case 'controller.noop':

    case 'noop':
      return { ok: true }

    case 'browser_navigate':
    case 'navigate': {
      if (!a.url) {return { ok: false, error: 'missing url' }}
      location.href = a.url

      return { ok: true }
    }

    case 'browser_back':

    case 'back':
      history.back()

      return { ok: true }

    case 'browser_scroll':
    case 'scroll': {
      const el = findElement(a)

      if (el && a.selector) {el.scrollIntoView({ block: 'center', behavior: 'smooth' })}
      else if (el) {el.scrollIntoView({ block: 'center', behavior: 'smooth' })}
      else {window.scrollBy({ top: a.dy ?? 600, left: a.dx ?? 0, behavior: 'smooth' })}

      return { ok: true, element: a.selector || a.text ? describe(el) : 'window' }
    }

    case 'browser_click':
    case 'click': {
      const el = findElement(a)

      if (!el) {return { ok: false, error: 'element not found' }
      ;}

(el as HTMLElement).scrollIntoView({ block: 'nearest' })
      const r = el.getBoundingClientRect()
      const cx = r.x + r.width / 2
      const cy = r.y + r.height / 2

      for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) {
        el.dispatchEvent(
          new MouseEvent(type, { bubbles: true, cancelable: true, clientX: cx, clientY: cy, view: window }),
        )
      }

      if (el instanceof HTMLElement) {el.click()}

      return { ok: true, element: describe(el) }
    }

    case 'browser_press':
    case 'press': {
      const key = a.key ?? 'Enter'
      const el = document.activeElement ?? document.body

      for (const type of ['keydown', 'keypress', 'keyup']) {
        el.dispatchEvent(
          new KeyboardEvent(type, { bubbles: true, cancelable: true, key, code: key === 'Enter' ? 'Enter' : key }),
        )
      }

      return { ok: true, key }
    }

    case 'browser_type':
    case 'type': {
      const el = a.selector || a.text ? findElement(a) : document.activeElement

      if (!el) {return { ok: false, error: 'element not found' }}
      const text = a.text ?? ''

      if (a.mode === 'typewrite') {
        // realistic typing for fields that need key events (tweets, search boxes)
        ;(el as HTMLElement).focus()

        for (const ch of text) {
          for (const type of ['keydown', 'keypress', 'input', 'keyup']) {
            const ev =
              type === 'input'
                ? new InputEvent('input', { bubbles: true, data: ch, inputType: 'insertText' })
                : new KeyboardEvent(type as 'keydown', { bubbles: true, key: ch })

            el.dispatchEvent(ev)
          }

          if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
            el.value += ch
          } else if ((el as HTMLElement).isContentEditable) {
            document.execCommand('insertText', false, ch)
          }

          await new Promise((r) => setTimeout(r, 12))
        }
      } else {
        await typeInto(el, text, a.mode === 'append')
      }

      return { ok: true, element: describe(el) }
    }

    case 'compose': {
      // High-level: find best field on page if no selector (composer detection).
      let el = a.selector || a.text ? findElement(a) : null

      if (!el) {
        el =
          document.querySelector('[contenteditable="true"]') ??
          document.querySelector('textarea') ??
          document.querySelector('input[type=text]')
      }

      if (!el) {return { ok: false, error: 'no compose target found' }}
      await typeInto(el, a.text ?? '', a.mode === 'append')

      return { ok: true, element: describe(el) }
    }

    case 'browser_snapshot':
    case 'snapshot': {
      const items: string[] = []

      const interactive = document.querySelectorAll(
        'a[href],button,[role=button],[role=link],input,textarea,select,[contenteditable=true],h1,h2,[role=heading]'
      )

      let i = 0

      for (const el of interactive) {
        if (i++ > 140) {break}
        const r = el.getBoundingClientRect()

        if (r.bottom < 0 || r.top > innerHeight * 2 || r.width === 0) {continue}

        const label =
          el.getAttribute('aria-label') ??
          (el as HTMLInputElement).placeholder ??
          (el.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 60)

        if (!label) {continue}
        items.push(`${el.localName}[${uniqueSelector(el)}] "${label}" @${Math.round(r.x)},${Math.round(r.y)}`)
      }

      return {
        ok: true,
        url: location.href,
        title: document.title,
        elements: items,
      }
    }

    case 'browser_read':
    case 'read': {
      const el = findElement(a) ?? document.body

      return { ok: true, element: describe(el), text: (el.textContent ?? '').trim().slice(0, 8000) }
    }

    case 'dom_hide': {
      const el = findElement(a)

      if (!el) {return { ok: false, error: 'element not found' }
      ;}

(el as HTMLElement).style.setProperty('display', 'none', 'important')

      return { ok: true, element: describe(el) }
    }

    case 'dom_style': {
      const el = findElement(a)

      if (!el) {return { ok: false, error: 'element not found' }}

      for (const [k, v] of Object.entries(a.css ?? {})) {
        ;(el as HTMLElement).style.setProperty(k.replace(/[A-Z]/g, (m) => '-' + m.toLowerCase()), v, 'important')
      }

      return { ok: true, element: describe(el) }
    }

    case 'dom_insert': {
      const el = findElement(a)

      if (!el) {return { ok: false, error: 'element not found' }}
      const html = a.html ?? ''
      const pos = a.position ?? 'after'
      const map = { before: 'beforebegin', after: 'afterend', 'inside-start': 'afterbegin', 'inside-end': 'beforeend' } as const
      el.insertAdjacentHTML(map[pos], html)

      return { ok: true, element: describe(el) }
    }

    case 'highlight': {
      const el = findElement(a)

      if (!el) {return { ok: false, error: 'element not found' }}
      const r = el.getBoundingClientRect()
      const box = document.createElement('div')
      box.className = 'hr-eloutline'
      box.style.cssText = `position:fixed;left:${r.x - 4}px;top:${r.y - 4}px;width:${r.width + 8}px;height:${r.height + 8}px;border:2px solid #5470ff;border-radius:6px;background:rgba(84,112,255,.14);z-index:2147483643;pointer-events:none;transition:opacity .4s`
      document.documentElement.appendChild(box)
      setTimeout(() => {
        box.style.opacity = '0'
        setTimeout(() => box.remove(), 450)
      }, a.ms ?? 1600)

      return { ok: true, element: describe(el) }
    }

    case 'annotate': {
      const el = findElement(a)

      if (!el) {return { ok: false, error: 'element not found' }}
      const r = el.getBoundingClientRect()
      const tag = document.createElement('div')
      tag.textContent = a.label ?? a.text ?? ''
      tag.style.cssText = `position:fixed;left:${r.x}px;top:${r.y - 30}px;z-index:2147483643;background:#3b5bff;color:#fff;padding:4px 10px;border-radius:8px;font:600 12px system-ui;pointer-events:none;box-shadow:0 4px 14px rgba(0,0,0,.4)`
      document.documentElement.appendChild(tag)
      setTimeout(() => tag.remove(), a.ms ?? 4000)

      return { ok: true, element: describe(el) }
    }

    case 'window.open':
    case 'widget.open': {
      if (!wm) {return { ok: false, error: 'no window manager' }}

      const id = wm.open({
        title: (a.label as string) ?? a.title,
        kind: a.kind as 'thought' | 'embed' | 'html' | 'feed' | 'search' | undefined,
        content: a.text ?? a.html,
        url: a.url,
        items: a.items as { title: string; subtitle?: string; image?: string; url?: string; badge?: string }[] | undefined,
        placeholder: a.placeholder as string | undefined,
        size: a.size as 'sm' | 'md' | 'lg' | 'full' | undefined,
      })

      return { ok: true, windowId: id }
    }

    case 'window.close': {
      wm?.close(String(a.id ?? ''))

      return { ok: true }
    }

    case 'window.fullscreen': {
      // toggled via grow button in the window itself; bots just reopen bigger.
      if (a.id) {
        wm?.close(String(a.id))
        wm?.open({
          id: String(a.id),
          title: a.title as string | undefined,
          kind: a.kind as 'thought' | 'embed' | 'html' | undefined,
          content: a.text ?? a.html,
          url: a.url,
          size: 'full',
        })
      }

      return { ok: true }
    }

    default:
      return { ok: false, error: `unknown action ${action}` }
  }
}
