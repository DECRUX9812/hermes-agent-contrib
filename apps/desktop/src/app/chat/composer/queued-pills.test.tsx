import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useRef } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useSessionSlice } from '@/lib/use-session-slice'
import type { ComposerAttachment } from '@/store/composer'
import {
  $queuedPromptsBySession,
  dequeueQueuedPrompt,
  enqueueQueuedPrompt,
  type QueuedPromptEntry,
  removeQueuedPrompt,
  simulateComposerQueueReloadForTests
} from '@/store/composer-queue'
import { clearAllPrompts, setApprovalRequest } from '@/store/prompts'
import { setSessionsLoading } from '@/store/session'

import type { QueueEditState } from './composer-utils'
import { useComposerQueue } from './hooks/use-composer-queue'
import { useComposerSubmit } from './hooks/use-composer-submit'
import { QUEUED_PILL_FOLD_ABOVE, QueuedPills } from './queued-pills'

const SESSION_KEY = 'rt-queued-pills'
const SESSION_ID = 'rt-queued-pills-runtime'
const DRAFT_TEXT = 'also check the windows build'

const entry = (id: string, text: string): QueuedPromptEntry => ({ attachments: [], id, queuedAt: Date.now(), text })

function pillRowCount(container: HTMLElement) {
  return container.querySelectorAll('[data-slot="queued-pill"]').length
}

describe('QueuedPills', () => {
  afterEach(cleanup)

  it('reserves no space while the queue is empty', () => {
    const view = render(<QueuedPills entries={[]} onDelete={vi.fn()} onEdit={vi.fn()} />)

    expect(view.container.querySelector('[data-slot="composer-queued-pills"]')).toBeNull()
    expect(view.container.innerHTML).toBe('')
  })

  it('shows one line per queued turn and starts an edit from it', () => {
    const onEdit = vi.fn()
    render(
      <QueuedPills
        entries={[entry('q1', 'first queued turn'), entry('q2', 'second queued turn')]}
        onDelete={vi.fn()}
        onEdit={onEdit}
      />
    )

    expect(screen.getByText('first queued turn')).toBeTruthy()
    expect(screen.getByText('second queued turn')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'first queued turn' }))
    expect(onEdit).toHaveBeenCalledWith(expect.objectContaining({ id: 'q1' }))
  })

  it('drops a queued turn from its X', () => {
    const onDelete = vi.fn()
    render(<QueuedPills entries={[entry('q1', 'drop me')]} onDelete={onDelete} onEdit={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    expect(onDelete).toHaveBeenCalledWith('q1')
  })

  it('folds past two entries to a count in tabular figures and unfolds on edit', () => {
    const entries = [entry('q1', 'one'), entry('q2', 'two'), entry('q3', 'three')]
    const view = render(<QueuedPills entries={entries} onDelete={vi.fn()} onEdit={vi.fn()} />)

    expect(QUEUED_PILL_FOLD_ABOVE).toBe(2)
    expect(pillRowCount(view.container)).toBe(0)
    expect(screen.queryByText('three')).toBeNull()

    const count = screen.getByText('3')
    expect(count.classList.contains('tabular-nums')).toBe(true)

    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    expect(pillRowCount(view.container)).toBe(3)
    expect(screen.getByText('three')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Collapse' }))
    expect(pillRowCount(view.container)).toBe(0)
  })
})

/**
 * The composer's own path: a session parked on an approval cannot take a
 * redirect, so Enter queues the turn. These pin that the queued turn is then
 * visible next to the input, and that it leaves with the queue.
 */
function BusyComposerHarness({ onCancel = vi.fn() }: { onCancel?: () => void }) {
  const draftRef = useRef(DRAFT_TEXT)
  const editorRef = useRef<HTMLDivElement | null>(null)
  const queueEditRef = useRef<QueueEditState | null>(null)
  const attachments: ComposerAttachment[] = []
  const entries = useSessionSlice($queuedPromptsBySession, SESSION_KEY)

  if (!editorRef.current) {
    const editor = window.document.createElement('div')

    editor.dataset.slot = 'composer-rich-input'
    editor.textContent = DRAFT_TEXT
    editorRef.current = editor
  }

  const clearDraft = () => {
    draftRef.current = ''

    if (editorRef.current) {
      editorRef.current.textContent = ''
    }
  }

  const queue = useComposerQueue({
    activeQueueSessionKey: SESSION_KEY,
    attachments,
    busy: true,
    clearDraft,
    draftRef,
    focusInput: vi.fn(),
    loadIntoComposer: vi.fn(),
    onCancel,
    onSteer: vi.fn(async () => true),
    onSubmit: vi.fn(async () => true),
    queueEditRef,
    queueSessionKey: SESSION_KEY,
    sessionId: SESSION_ID
  })

  const submit = useComposerSubmit({
    activeQueueSessionKey: SESSION_KEY,
    activeQueueSessionKeyRef: { current: SESSION_KEY },
    attachments,
    busy: true,
    clearDraft,
    disabled: false,
    draftScopeRef: { current: SESSION_KEY },
    draftRef,
    drainNextQueued: vi.fn(async () => false),
    editorRef,
    exitQueuedEdit: queue.exitQueuedEdit,
    focusInput: vi.fn(),
    inputDisabled: false,
    loadIntoComposer: vi.fn(),
    onCancel,
    onSteer: vi.fn(async () => true),
    onSteerHidden: vi.fn(async () => true),
    onSubmit: vi.fn(async () => true),
    queueCurrentDraft: queue.queueCurrentDraft,
    queueEdit: queue.queueEdit,
    queuedPrompts: queue.queuedPrompts,
    sessionId: SESSION_ID,
    setComposerText: vi.fn(),
    stashAt: vi.fn()
  })

  return (
    <>
      <button onClick={() => submit.submitDraft()} type="button">
        press enter
      </button>
      <QueuedPills
        entries={entries}
        onDelete={id => removeQueuedPrompt(SESSION_KEY, id)}
        onEdit={queue.beginQueuedEdit}
      />
    </>
  )
}

describe('the queued pill on the composer', () => {
  beforeEach(() => {
    window.localStorage.clear()
    $queuedPromptsBySession.set({})
    clearAllPrompts()
    setSessionsLoading(false)
    // The turn is parked inside a tool batch: a steer cannot reach the model,
    // so Enter queues (use-composer-submit's blockingPrompt branch).
    setApprovalRequest({ command: 'rm -rf build', description: 'dangerous', sessionId: SESSION_ID })
  })

  afterEach(() => {
    cleanup()
    clearAllPrompts()
    $queuedPromptsBySession.set({})
    setSessionsLoading(true)
  })

  it('shows the turn Enter queued while the session is parked', () => {
    const onCancel = vi.fn()
    const view = render(<BusyComposerHarness onCancel={onCancel} />)

    fireEvent.click(screen.getByRole('button', { name: 'press enter' }))

    expect(screen.getByText(DRAFT_TEXT)).toBeTruthy()
    expect(pillRowCount(view.container)).toBe(1)
    // The parked turn keeps running: queueing never ends it.
    expect(onCancel).not.toHaveBeenCalled()
  })

  it('drops the queued turn from the pill through the real queue', () => {
    const view = render(<BusyComposerHarness />)

    fireEvent.click(screen.getByRole('button', { name: 'press enter' }))
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))

    expect($queuedPromptsBySession.get()[SESSION_KEY]).toBeUndefined()
    expect(pillRowCount(view.container)).toBe(0)
  })

  it('clears the pill when the turn drains the queue', async () => {
    const view = render(<BusyComposerHarness />)

    fireEvent.click(screen.getByRole('button', { name: 'press enter' }))
    expect(pillRowCount(view.container)).toBe(1)

    const drained = dequeueQueuedPrompt(SESSION_KEY)

    expect(drained?.text).toBe(DRAFT_TEXT)
    await act(async () => {})
    expect(pillRowCount(view.container)).toBe(0)
  })

  it('brings the queued turn back from persisted storage after a window reload', () => {
    enqueueQueuedPrompt(SESSION_KEY, { attachments: [], text: 'queued before the reload' })

    // A renderer restart rehydrates the atom from the persisted queue; nothing
    // in the pill's own state is what keeps the entry visible.
    simulateComposerQueueReloadForTests()

    const view = render(<BusyComposerHarness />)

    expect(screen.getByText('queued before the reload')).toBeTruthy()
    expect(pillRowCount(view.container)).toBe(1)
  })
})
