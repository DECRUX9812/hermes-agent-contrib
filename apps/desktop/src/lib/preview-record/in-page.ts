/**
 * Guest-page recorder. Injected as source into the preview webview — no
 * imports, no module constants, every value the body needs lives inside
 * `recordInPage`. Same self-containment contract as `annotateInPage`.
 *
 * Captures the human's own clicks, field entries, and Enter presses so a
 * demonstration of "how to do X in this app" survives as an ordered step
 * list. Only trusted (real-input) events count: a click the page
 * synthesizes is part of the page, not the demonstration.
 *
 * Navigation is handled by the HOST: a fresh document means a fresh
 * install, and the host appends the `navigate` step itself — a guest page
 * cannot observe its own teardown.
 */

export interface RecordedStep {
  kind: 'click' | 'navigate' | 'press' | 'type'
  /** press: the key name ('Enter'). */
  key?: string
  /** Human-readable target — aria-label, placeholder, text — truncated. */
  label?: string
  /** type on a password field records the STEP but never the value. */
  redacted?: boolean
  /** Stable-enough css the replay can re-resolve: #id, [name=], or a
   *  short tag/nth-of-type path. */
  selector?: string
  /** navigate: the destination. */
  url?: string
  /** type: the final field value, truncated. */
  value?: string
}

export const RECORD_STEPS_LIMIT = 400

const INTERACTIVE = 'a,button,input,select,textarea,label,summary,[role="button"],[role="link"],[onclick],[tabindex]'

const FORM_FIELD = 'INPUT,TEXTAREA,SELECT'

export function recordInPage(doc: Document, isTrustedEvent?: (event: Event) => boolean) {
  const trusted = isTrustedEvent || ((event: Event) => event.isTrusted)
  let steps: RecordedStep[] = []
  let bound = false

  const clip = (value: null | string | undefined, max = 40) => (value || '').replace(/\s+/g, ' ').trim().slice(0, max)

  /** Attribute value inside a `["…"]` selector: close the string honestly. */
  const quoted = (value: string) => `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`

  /** `#id` for sane ids, `[id="…"]` otherwise — `#foo.bar` resolves nothing. */
  const idSelector = (id: string) => (/^[A-Za-z][\w-]*$/.test(id) ? `#${id}` : `[id=${quoted(id)}]`)

  function selectorFor(el: Element): string | undefined {
    const element = el as HTMLElement

    if (element.id) {
      return idSelector(element.id)
    }

    const testId = element.getAttribute('data-testid')

    if (testId) {
      return `[data-testid=${quoted(clip(testId, 80))}]`
    }

    const name = element.getAttribute('name')

    if (name) {
      return `${element.tagName.toLowerCase()}[name=${quoted(clip(name, 80))}]`
    }

    const aria = element.getAttribute('aria-label')

    if (aria) {
      return `[aria-label=${quoted(clip(aria, 60))}]`
    }

    // Fallback: a short tag + nth-of-type path — two levels of climb is
    // enough to disambiguate most controls without roping layout into it.
    const parts: string[] = []
    let node: Element | null = el

    for (let depth = 0; node && node !== doc.documentElement && depth < 3; depth += 1) {
      const parent: Element | null = node.parentElement
      const tag = node.tagName.toLowerCase()
      let part = tag

      if (parent) {
        const siblings = Array.from(parent.children).filter(
          (sibling: Element) => sibling.tagName === (node as Element).tagName
        )

        if (siblings.length > 1) {
          part = `${tag}:nth-of-type(${siblings.indexOf(node) + 1})`
        }
      }

      parts.unshift(part)
      node = parent

      if (node && (node as HTMLElement).id) {
        parts.unshift(idSelector((node as HTMLElement).id))

        break
      }
    }

    return parts.join(' > ') || undefined
  }

  function labelFor(el: Element): string | undefined {
    const element = el as HTMLElement

    const label =
      clip(element.getAttribute('aria-label')) ||
      clip(element.getAttribute('placeholder')) ||
      clip(element.innerText || element.textContent) ||
      clip(element.getAttribute('name')) ||
      clip(element.getAttribute('title')) ||
      clip(element.getAttribute('value'))

    return label || element.tagName.toLowerCase()
  }

  function push(step: RecordedStep) {
    if (steps.length >= RECORD_STEPS_LIMIT) {
      return
    }

    const last = steps[steps.length - 1]

    // A double-fire on the same control (click + change on a checkbox, a
    // label click forwarding to its input) is one demonstrated action.
    if (last && last.kind === step.kind && last.selector === step.selector) {
      if (step.kind === 'click' || step.kind === 'press') {
        return
      }

      if (step.kind === 'type') {
        last.value = step.value
        last.redacted = step.redacted

        return
      }
    }

    steps.push(step)
  }

  const onClick = (event: Event) => {
    if (!trusted(event)) {
      return
    }

    const el = event.target as Element | null

    if (!el || el === doc.documentElement || el === doc.body) {
      return
    }

    // The semantic control owns the step — a click on a button's <svg> is a
    // click on the button.
    const target = (el.closest?.(INTERACTIVE) || el) as Element
    push({ kind: 'click', label: labelFor(target), selector: selectorFor(target) })
  }

  const onChange = (event: Event) => {
    if (!trusted(event)) {
      return
    }

    const el = event.target as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement | null

    if (!el || !FORM_FIELD.includes(el.tagName)) {
      return
    }

    const selector = selectorFor(el)
    const label = labelFor(el)
    const inputType = (el as HTMLInputElement).type?.toLowerCase() || ''

    if (inputType === 'password') {
      push({ kind: 'type', label, redacted: true, selector })

      return
    }

    if (el.tagName === 'SELECT') {
      const option = (el as HTMLSelectElement).selectedOptions?.[0]
      push({ kind: 'type', label, selector, value: clip(option?.textContent || el.value, 80) })

      return
    }

    // A checkbox/radio toggles — the click listener already recorded it, and
    // the same-selector collapse keeps this from double-counting.
    if (inputType === 'checkbox' || inputType === 'radio') {
      push({ kind: 'click', label, selector })

      return
    }

    push({ kind: 'type', label, selector, value: clip(el.value, 200) })
  }

  const onKeyDown = (event: Event) => {
    if (!trusted(event)) {
      return
    }

    const key = (event as KeyboardEvent).key

    if (key !== 'Enter' && key !== 'Tab') {
      return
    }

    const el = event.target as Element | null
    push({
      kind: 'press',
      key,
      label: el ? labelFor(el) : undefined,
      selector: el ? selectorFor(el) : undefined
    })
  }

  const bind = () => {
    if (bound) {
      return
    }

    // Capture phase: a page that swallows the event in its own handlers still
    // demonstrates the action to the recorder.
    doc.addEventListener('click', onClick, true)
    doc.addEventListener('change', onChange, true)
    doc.addEventListener('keydown', onKeyDown, true)
    bound = true
  }

  const unbind = () => {
    doc.removeEventListener('click', onClick, true)
    doc.removeEventListener('change', onChange, true)
    doc.removeEventListener('keydown', onKeyDown, true)
    bound = false
  }

  return {
    /** Take the recorded steps, leaving the recorder running. */
    drain: () => {
      const out = steps
      steps = []

      return out
    },
    install: bind,
    isFull: () => steps.length >= RECORD_STEPS_LIMIT,
    isInstalled: () => bound,
    teardown: () => {
      unbind()
      steps = []
    }
  }
}

/** Source for `executeJavaScript` — the guest page has no module graph. */
export function recordInPageSource(): string {
  return `(${recordInPage.toString()})(document)`
}
