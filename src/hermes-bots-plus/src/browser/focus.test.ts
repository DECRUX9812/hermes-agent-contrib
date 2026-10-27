import { afterEach, describe, expect, it } from 'vitest'

import { actionAllowedInInput, isEditableTarget } from '@/lib/keybinds/combo'
import { composerFocusBlockedBySurface } from '@/lib/keybinds/composer-focus-keys'

import { floatKeyAction, type KeyLike, remoteKeyRoute } from './focus'

const key = (k: string, extra: Partial<KeyLike> = {}): KeyLike => ({
  key: k,
  altKey: false,
  ctrlKey: false,
  metaKey: false,
  shiftKey: false,
  defaultPrevented: false,
  isComposing: false,
  ...extra
})

describe('floating browser keys', () => {
  it('Esc minimises the float', () => {
    expect(floatKeyAction(key('Escape'))).toBe('minimise')
  })

  it('leaves an Esc something already handled (the address bar cancelling an edit)', () => {
    expect(floatKeyAction(key('Escape', { defaultPrevented: true }))).toBe('none')
  })

  it('leaves Esc to an IME that is composing', () => {
    expect(floatKeyAction(key('Escape', { isComposing: true }))).toBe('none')
  })

  it('ignores modified Esc and every other key', () => {
    expect(floatKeyAction(key('Escape', { metaKey: true }))).toBe('none')
    expect(floatKeyAction(key('Escape', { ctrlKey: true }))).toBe('none')
    expect(floatKeyAction(key('k', { metaKey: true }))).toBe('none')
    expect(floatKeyAction(key('a'))).toBe('none')
  })
})

describe('remote page keys', () => {
  it('types printable keys and sends named keys', () => {
    expect(remoteKeyRoute(key('a'), false)).toBe('text')
    expect(remoteKeyRoute(key('/'), false)).toBe('text')
    expect(remoteKeyRoute(key(' '), false)).toBe('text')
    expect(remoteKeyRoute(key('Enter'), false)).toBe('key')
    expect(remoteKeyRoute(key('PageDown'), false)).toBe('key')
    expect(remoteKeyRoute(key('ArrowLeft'), true)).toBe('key')
  })

  it('never takes an app chord: Cmd/Ctrl-K and friends pass to the app', () => {
    expect(remoteKeyRoute(key('k', { metaKey: true }), false)).toBe('pass')
    expect(remoteKeyRoute(key('k', { ctrlKey: true }), true)).toBe('pass')
    expect(remoteKeyRoute(key('ArrowLeft', { altKey: true }), false)).toBe('pass')
  })

  it('gives Esc to the page in a tab but to the window when floating', () => {
    expect(remoteKeyRoute(key('Escape'), false)).toBe('key')
    expect(remoteKeyRoute(key('Escape'), true)).toBe('pass')
  })

  it('skips handled, composing and unknown keys', () => {
    expect(remoteKeyRoute(key('a', { defaultPrevented: true }), false)).toBe('pass')
    expect(remoteKeyRoute(key('a', { isComposing: true }), false)).toBe('pass')
    expect(remoteKeyRoute(key('F5'), false)).toBe('pass')
    expect(remoteKeyRoute(key('Shift'), false)).toBe('pass')
  })
})

// The browser relies on the app's own shortcut rules rather than fighting
// them. These pin the parts of those rules it depends on.
describe('app shortcut rules the browser depends on', () => {
  afterEach(() => {
    document.body.innerHTML = ''
  })

  it("the remote page's key sink counts as typing, so bare chat keys stand down", () => {
    const sink = document.createElement('textarea')
    sink.setAttribute('data-browser-keysink', '')
    document.body.append(sink)
    expect(isEditableTarget(sink)).toBe(true)
    expect(actionAllowedInInput('composer.focus', 'enter')).toBe(false)
    expect(actionAllowedInInput('composer.focus', '/')).toBe(false)
    expect(actionAllowedInInput('session.scrollDown', 'pagedown')).toBe(false)
  })

  it('Cmd/Ctrl-K still opens the palette while typing in the page', () => {
    expect(actionAllowedInInput('nav.commandPalette', 'mod+k')).toBe(true)
  })

  it('a focused remote page owns its keys the way the terminal does', () => {
    document.body.innerHTML = '<div data-terminal=""><textarea data-browser-keysink=""></textarea></div>'
    document.querySelector<HTMLTextAreaElement>('textarea')!.focus()
    expect(composerFocusBlockedBySurface()).toBe(true)
  })

  it('an open float is not a modal: chat type-to-focus keeps working elsewhere', () => {
    document.body.innerHTML = '<div data-hermes-browser-float="" role="region"></div><input />'
    document.querySelector<HTMLInputElement>('input')!.blur()
    expect(composerFocusBlockedBySurface()).toBe(false)
  })
})
