import { afterEach, describe, expect, it } from 'vitest'

import { RECORD_STEPS_LIMIT, recordInPage } from './in-page'

/** jsdom can only mint untrusted events and isTrusted is non-configurable on
 *  each instance — the recorder's injectable predicate stands in for it. */
let trustedFlag = true
const isTrusted = () => trustedFlag

const click = (el: Element) => el.dispatchEvent(new MouseEvent('click', { bubbles: true }))
const change = (el: Element) => el.dispatchEvent(new Event('change', { bubbles: true }))

const keydown = (el: Element, key: string) =>
  el.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key }))

let api: ReturnType<typeof recordInPage> | undefined

afterEach(() => {
  api?.teardown()
  api = undefined
  trustedFlag = true
  document.body.replaceChildren()
})

describe('recordInPage', () => {
  it('records a click with the control’s label and selector', () => {
    const button = document.createElement('button')
    button.id = 'save'
    button.textContent = 'Save'
    document.body.appendChild(button)

    api = recordInPage(document, isTrusted)
    api.install()
    click(button)

    expect(api.drain()).toEqual([{ kind: 'click', label: 'Save', selector: '#save' }])
  })

  it('resolves a click on nested markup to the owning control', () => {
    const button = document.createElement('button')
    button.setAttribute('aria-label', 'Submit form')
    button.innerHTML = '<span><svg></svg></span>'
    document.body.appendChild(button)

    api = recordInPage(document, isTrusted)
    api.install()
    click(button.querySelector('svg')!)

    const [step] = api.drain()
    expect(step.kind).toBe('click')
    expect(step.label).toBe('Submit form')
    expect(step.selector).toBe('[aria-label="Submit form"]')
  })

  it('records a field’s final value on change', () => {
    const input = document.createElement('input')
    input.name = 'title'
    input.placeholder = 'Task title'
    document.body.appendChild(input)

    api = recordInPage(document, isTrusted)
    api.install()
    input.value = 'Buy milk'
    change(input)

    expect(api.drain()).toEqual([
      { kind: 'type', label: 'Task title', selector: 'input[name="title"]', value: 'Buy milk' }
    ])
  })

  it('keeps the step but never the text for a password field', () => {
    const input = document.createElement('input')
    input.type = 'password'
    input.name = 'pw'
    document.body.appendChild(input)

    api = recordInPage(document, isTrusted)
    api.install()
    input.value = 'hunter2'
    change(input)

    const [step] = api.drain()
    expect(step.kind).toBe('type')
    expect(step.redacted).toBe(true)
    expect(step.value).toBeUndefined()
  })

  it('collapses the click+change double-fire on a checkbox', () => {
    const input = document.createElement('input')
    input.type = 'checkbox'
    input.id = 'agree'
    document.body.appendChild(input)

    api = recordInPage(document, isTrusted)
    api.install()
    click(input)
    change(input)

    expect(api.drain()).toEqual([{ kind: 'click', label: 'input', selector: '#agree' }])
  })

  it('records Enter and Tab presses with their field', () => {
    const input = document.createElement('input')
    input.name = 'q'
    document.body.appendChild(input)

    api = recordInPage(document, isTrusted)
    api.install()
    keydown(input, 'Enter')

    const [step] = api.drain()
    expect(step).toMatchObject({ key: 'Enter', kind: 'press', selector: 'input[name="q"]' })
  })

  it('ignores events the page synthesizes itself', () => {
    const button = document.createElement('button')
    document.body.appendChild(button)

    api = recordInPage(document, isTrusted)
    api.install()
    trustedFlag = false
    button.dispatchEvent(new MouseEvent('click', { bubbles: true })) // untrusted

    expect(api.drain()).toEqual([])
  })

  it('drain takes the list and leaves the recorder running', () => {
    const button = document.createElement('button')
    document.body.appendChild(button)

    api = recordInPage(document, isTrusted)
    api.install()
    click(button)
    expect(api.drain()).toHaveLength(1)
    click(button)
    expect(api.drain()).toHaveLength(1)
  })

  it('stops taking steps past the cap', () => {
    api = recordInPage(document, isTrusted)
    api.install()

    for (let i = 0; i < RECORD_STEPS_LIMIT + 2; i += 1) {
      const button = document.createElement('button')
      button.setAttribute('data-testid', `b${i}`)
      document.body.appendChild(button)
      click(button)
      button.remove()
    }

    expect(api.isFull()).toBe(true)
    expect(api.drain()).toHaveLength(RECORD_STEPS_LIMIT)
  })

  it('teardown unbinds and clears', () => {
    const button = document.createElement('button')
    document.body.appendChild(button)

    api = recordInPage(document, isTrusted)
    api.install()
    api.teardown()
    click(button)

    expect(api.isInstalled()).toBe(false)
    expect(api.drain()).toEqual([])
  })
})
