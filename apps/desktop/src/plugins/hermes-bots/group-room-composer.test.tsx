import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { GroupRoomComposer } from './group-room-composer'
import { translateBots } from './i18n-test-helper'
import type { GroupMember } from './types'

const { host } = vi.hoisted(() => ({ host: {} as Record<string, unknown> }))

vi.mock('@hermes/plugin-sdk', async () => {
  const { pluginSdkMock } = await import('./group-test-utils')
  const base = await pluginSdkMock(host)

  return {
    ...base,
    Button: (props: React.ComponentProps<'button'>) => <button type="button" {...props} />,
    cn: (...values: unknown[]) => values.filter(Boolean).join(' '),
    Codicon: () => null,
    Textarea: (props: React.ComponentProps<'textarea'>) => <textarea {...props} />,
    Tip: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
    useI18n: () => ({ t: (_key: string, fallback: string) => fallback }),
    usePluginI18n: () => translateBots
  }
})

const MEMBERS: GroupMember[] = [{ handle: 'builder', name: 'builder', title: '' }]

function mount(initial = '') {
  const onSubmit = vi.fn()
  const onEscape = vi.fn()

  function Harness() {
    const [value, setValue] = useState(initial)

    return (
      <GroupRoomComposer
        ariaLabel="Message Room"
        images={[]}
        members={MEMBERS}
        onChange={setValue}
        onEscape={onEscape}
        onPaste={() => {}}
        onPick={() => {}}
        onRemoveImage={() => {}}
        onSubmit={onSubmit}
        placeholder="Start a thread"
        sendLabel="Send it"
        value={value}
      />
    )
  }

  render(<Harness />)

  return {
    input: screen.getByLabelText('Message Room') as HTMLTextAreaElement,
    onEscape,
    onSubmit,
    send: screen.getByLabelText('Send it') as HTMLButtonElement
  }
}

afterEach(cleanup)

describe('GroupRoomComposer', () => {
  it('disables send when empty and enables it with text', () => {
    const { send } = mount()

    expect(send.disabled).toBe(true)

    cleanup()
    const filled = mount('hello')

    expect(filled.send.disabled).toBe(false)
  })

  it('sends on Enter but not on Shift+Enter', () => {
    const { input, onSubmit } = mount('hello')

    fireEvent.keyDown(input, { key: 'Enter', shiftKey: true })
    expect(onSubmit).not.toHaveBeenCalled()

    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onSubmit).toHaveBeenCalledTimes(1)
  })

  it('sends through the submit button and forwards Escape', () => {
    const { onEscape, onSubmit, send } = mount('hello')

    fireEvent.click(send)
    expect(onSubmit).toHaveBeenCalledTimes(1)

    const { input } = { input: screen.getByLabelText('Message Room') as HTMLTextAreaElement }
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(onEscape).toHaveBeenCalledTimes(1)
  })
})
