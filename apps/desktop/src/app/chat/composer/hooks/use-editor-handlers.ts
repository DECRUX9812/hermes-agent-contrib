import {
  type ClipboardEvent,
  type FormEvent,
  type KeyboardEvent,
  type MutableRefObject,
  useEffect,
  useRef
} from 'react'

import { chatMessageText } from '@/lib/chat-messages'
import { sanitizeComposerInput } from '@/lib/composer-input-sanitize'
import { DATA_IMAGE_URL_RE } from '@/lib/embedded-images'
import { triggerHaptic } from '@/lib/haptics'
import { type ComposerAttachment } from '@/store/composer'
import {
  browseBackward,
  browseForward,
  deriveUserHistory,
  isBrowsingHistory
} from '@/store/composer-input-history'

import {
  acceptsTriggerCompletion,
  implicitSlashAcceptIndex,
  liveComposerDraft,
  slashArgStage
} from '../composer-utils'
import { shouldConvertPasteToAttachment } from '../large-paste'
import { chipTypedPathOnSpace, pathifyRefs } from '../path-refs'
import {
  composerPlainText,
  deleteChipBeforeCaret,
  deleteSelectionInEditor,
  insertComposerContentsAtCaret,
  normalizeComposerEditorDom
} from '../rich-editor'
import type { ComposerScope } from '../scope'
import { extractClipboardImageBlobs, openDirectiveScope } from '../text-utils'
import type { ChatBarProps } from '../types'
import { isRedoShortcut, isUndoShortcut } from '../undo-history'
import {
  chipTypedUrlOnSpace,
  linkifyUrls,
  markdownLinkFor,
  resolveExactLinkPaste,
  selectionLinkLabel
} from '../url-refs'

import type { useComposerDraft } from './use-composer-draft'
import type { useComposerQueue } from './use-composer-queue'
import type { useComposerSubmit } from './use-composer-submit'
import { triggerKeyUpHandler, type useComposerTrigger } from './use-composer-trigger'
import type { useComposerUndo } from './use-composer-undo'

type DraftApi = Pick<
  ReturnType<typeof useComposerDraft>,
  'draftRef' | 'editorRef' | 'loadIntoComposer' | 'setComposerText'
>
type QueueApi = Pick<
  ReturnType<typeof useComposerQueue>,
  | 'beginQueuedEdit'
  | 'drainNextQueued'
  | 'exitQueuedEdit'
  | 'queueEdit'
  | 'queuedPrompts'
  | 'sendQueuedNow'
  | 'stepQueuedEdit'
>
type SubmitApi = Pick<ReturnType<typeof useComposerSubmit>, 'queueDraft' | 'submitDraft'>
type TriggerApi = Pick<
  ReturnType<typeof useComposerTrigger>,
  | 'ascendTriggerPath'
  | 'closeTrigger'
  | 'commitTypedSlashDirective'
  | 'moveTriggerActive'
  | 'refreshTrigger'
  | 'replaceTriggerWithChip'
  | 'slashFreeTextArgStage'
  | 'trigger'
  | 'triggerActive'
  | 'triggerActiveExplicit'
  | 'triggerItems'
  | 'triggerKeyConsumedRef'
  | 'triggerLoading'
>
type UndoApi = Pick<
  ReturnType<typeof useComposerUndo>,
  'recordUndoPoint' | 'redo' | 'undo' | 'withUndoPoint'
>

export interface ComposerEditorHandlersOptions {
  attachments: ComposerAttachment[]
  awaitingInput: boolean
  busy: boolean
  composingRef: MutableRefObject<boolean>
  disabled?: boolean
  sessionId?: string | null
  scope: ComposerScope
  haltRun: () => unknown
  draft: DraftApi
  queue: QueueApi
  submit: SubmitApi
  trigger: TriggerApi
  undoApi: UndoApi
  onAttachImageBlob: ChatBarProps['onAttachImageBlob']
  onAttachPastedText: ChatBarProps['onAttachPastedText']
  onPasteClipboardImage: ChatBarProps['onPasteClipboardImage']
}

// The editor's DOM event surface: draft flushing (sync + rAF-coalesced),
// input/beforeinput/cut/paste, keydown routing (history, triggers, queue,
// undo, submit) and keyup. `composingRef` stays owned by ChatBar — the JSX
// compositionstart/end handlers write it too — so it arrives as a dep.
export function useComposerEditorHandlers(options: ComposerEditorHandlersOptions) {
  const {
    attachments,
    awaitingInput,
    busy,
    composingRef,
    disabled,
    sessionId,
    scope,
    haltRun,
    onAttachImageBlob,
    onAttachPastedText,
    onPasteClipboardImage
  } = options

  const { draftRef, editorRef, loadIntoComposer, setComposerText } = options.draft

  const {
    beginQueuedEdit,
    drainNextQueued,
    exitQueuedEdit,
    queueEdit,
    queuedPrompts,
    sendQueuedNow,
    stepQueuedEdit
  } = options.queue

  const { queueDraft, submitDraft } = options.submit

  const {
    ascendTriggerPath,
    closeTrigger,
    commitTypedSlashDirective,
    moveTriggerActive,
    refreshTrigger,
    replaceTriggerWithChip,
    slashFreeTextArgStage,
    trigger,
    triggerActive,
    triggerActiveExplicit,
    triggerItems,
    triggerKeyConsumedRef,
    triggerLoading
  } = options.trigger

  const { recordUndoPoint, redo, undo, withUndoPoint } = options.undoApi
  const flushRafRef = useRef<number | undefined>(undefined)

  const flushEditorToDraft = (editor: HTMLDivElement) => {
    if (flushRafRef.current !== undefined) {
      window.cancelAnimationFrame(flushRafRef.current)
      flushRafRef.current = undefined
    }

    normalizeComposerEditorDom(editor)

    const nextDraft = sanitizeComposerInput(composerPlainText(editor))

    if (nextDraft !== draftRef.current) {
      draftRef.current = nextDraft
      setComposerText(nextDraft)
    }

    window.setTimeout(refreshTrigger, 0)
  }

  // Coalesce the high-frequency input/paste flushes to one per frame. Immediate
  // paths (compositionend, Enter/keydown, submit) keep calling
  // flushEditorToDraft directly, which cancels any pending coalesced run first.
  const scheduleFlushEditorToDraft = (editor: HTMLDivElement) => {
    if (flushRafRef.current !== undefined) {
      return
    }

    flushRafRef.current = window.requestAnimationFrame(() => {
      flushRafRef.current = undefined
      flushEditorToDraft(editor)
    })
  }

  useEffect(
    () => () => {
      if (flushRafRef.current !== undefined) {
        window.cancelAnimationFrame(flushRafRef.current)
      }
    },
    []
  )

  const handleEditorInput = (event: FormEvent<HTMLDivElement>) => {
    // During IME composition the DOM contains uncommitted preedit text
    // mixed with real content.  Skip state writes — compositionend flushes
    // the finalized text (see onCompositionEnd).
    if (composingRef.current) {
      return
    }

    scheduleFlushEditorToDraft(event.currentTarget)
  }

  // Native typing/deleting mutates the DOM through Chromium's editing pipeline,
  // whose undo stack we've taken over — so bank the pre-edit state here, before
  // the change lands. `beforeinput` is the only hook that still sees the old
  // text. Consecutive keystrokes coalesce into one entry, so ⌘Z steps back by a
  // burst rather than a character.
  const handleEditorBeforeInput = (event: FormEvent<HTMLDivElement>) => {
    const inputType = (event.nativeEvent as InputEvent).inputType

    // Undo/redo are ours (handled in useComposerUndo + keydown), and IME preedit
    // is not a committed edit — compositionend is where that text becomes real.
    if (inputType === 'historyUndo' || inputType === 'historyRedo' || composingRef.current) {
      return
    }

    recordUndoPoint({ coalesce: inputType === 'insertText' || inputType === 'deleteContentBackward' })
  }

  // Cut never reaches the handler above: React's onBeforeInput is a
  // keypress/textInput polyfill and does not observe the native
  // `beforeinput` event, so Chromium's deleteByCut input type is invisible to
  // it. The native `cut` clipboard event still fires before the DOM mutation,
  // which is where the pre-edit snapshot has to be banked or ⌘Z skips the cut.
  const handleCut = () => {
    recordUndoPoint()
  }

  const handlePaste = (event: ClipboardEvent<HTMLDivElement>) => {
    const imageBlobs = extractClipboardImageBlobs(event.clipboardData)

    if (imageBlobs.length > 0 && onAttachImageBlob) {
      triggerHaptic('selection')

      for (const blob of imageBlobs) {
        void onAttachImageBlob(blob)
      }
    }

    // Trim surrounding whitespace so a copy that dragged along leading/trailing
    // blank lines (common when selecting from terminals, code blocks, web pages)
    // doesn't dump multiline padding into the composer. Internal newlines are
    // preserved — only the edges are cleaned up.
    const pastedText = sanitizeComposerInput(event.clipboardData.getData('text').trim())

    if (!pastedText) {
      event.preventDefault()

      if (imageBlobs.length > 0) {
        return
      }

      // Under WSL2/WSLg the Windows host clipboard doesn't bridge *images* to
      // the Linux clipboard the DOM paste event reads, so a host screenshot
      // arrives as an empty paste (no blobs, no text). Fall back to the main
      // process, which pulls the image straight off the Windows clipboard.
      // Silent so a genuinely-empty paste doesn't pop a "no image" warning.
      if (onPasteClipboardImage) {
        triggerHaptic('selection')
        void onPasteClipboardImage({ silent: true })
      }

      return
    }

    if (DATA_IMAGE_URL_RE.test(pastedText)) {
      event.preventDefault()

      return
    }

    event.preventDefault()

    // Pasting exactly one link while composer text is selected turns that text
    // into a markdown link instead of replacing it — the behavior every rich
    // editor ships (ported from block/buzz#6684). Selections that span chips
    // or lines fall through to the normal replace-with-chip path.
    const exactLink = resolveExactLinkPaste(pastedText)

    if (exactLink) {
      const label = selectionLinkLabel(event.currentTarget)

      if (label) {
        recordUndoPoint()
        insertComposerContentsAtCaret(event.currentTarget, markdownLinkFor(label, exactLink))
        scheduleFlushEditorToDraft(event.currentTarget)

        return
      }
    }

    // A paste past the large-paste threshold becomes a `.txt` attachment chip
    // instead of flooding the composer.
    // The instruction the user types stays in the input; the pasted source
    // material rides along as a file. Falls back to inline insertion if the
    // attachment can't be created (missing bridge, write failure) so the
    // paste is never lost.
    if (onAttachPastedText && shouldConvertPasteToAttachment(pastedText)) {
      const editor = event.currentTarget

      void Promise.resolve(onAttachPastedText(pastedText)).then(attached => {
        if (attached) {
          triggerHaptic('selection')

          return
        }

        recordUndoPoint()
        insertComposerContentsAtCaret(editor, pathifyRefs(linkifyUrls(pastedText)), openDirectiveScope(editor))
        scheduleFlushEditorToDraft(editor)
      })

      return
    }

    // Links in the paste land as `@url:` chips rather than a wall of URL text —
    // the same reference the "Add URL" dialog inserts, parsed in place so a link
    // mid-sentence keeps its position. Bare `@path` tokens promote the same way.
    // A paste into an open `@url:`/`@file:` scope CONSUMES that scope instead of
    // stacking on it — the scope is the browse mode the user is pasting into,
    // not text they typed and want to keep (`@url:@url:\`https://…\``).
    const scope = openDirectiveScope(event.currentTarget)

    recordUndoPoint()
    insertComposerContentsAtCaret(event.currentTarget, pathifyRefs(linkifyUrls(pastedText)), scope)
    scheduleFlushEditorToDraft(event.currentTarget)
  }

  const handleEditorKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    // Self-heal a stale composition flag before the guard below reads it.
    // compositionend can be missed (focus jumps, input-source switches, or a
    // programmatic DOM swap mid-preedit abort the composition without the
    // event reaching us), and a wedged composingRef silently swallows every
    // Enter — and, via the form onSubmit guard, the Send button — until the
    // component remounts (#44135). Chromium stamps isComposing on every
    // keydown of a genuine composition, so when the native flag says we're
    // not composing, trust it and recover.
    if (composingRef.current && !event.nativeEvent.isComposing) {
      composingRef.current = false
    }

    // IME composition: Enter confirms composed text, not a message submission.
    // We check both composingRef (set by compositionstart/compositionend, robust
    // across browsers) and nativeEvent.isComposing (Chromium fallback).  Without
    // this guard, pressing Enter to finalise a Korean/Japanese/Chinese IME
    // preedit fires submitDraft() and splits the message mid-word.
    if (composingRef.current || event.nativeEvent.isComposing) {
      return
    }

    // PageUp/PageDown: the composer is a single-line contentEditable — these
    // keys have no text-editing purpose, and letting their default bubble to
    // the browser's scroll-the-nearest-scrollable-ancestor behavior breaks the
    // chat layout in the desktop pane tree (large blank area, sidebar pushed
    // off-screen — #49978). Swallow the default here; the global
    // conversation.scrollPageUp/Down keybind turns the intent into an
    // explicit, focused-transcript page instead.
    if (event.key === 'PageUp' || event.key === 'PageDown') {
      event.preventDefault()

      return
    }

    // macOS Chinese IME (and some 3rd-party IMEs on Windows) emit Enter with
    // keyCode 229 (legacy VK_PROCESSKEY) while isComposing is already false.
    // The compositionend has fired but the keydown still carries 229, signalling
    // "this Enter is an IME commit, not a user send".  If we let it through,
    // the message fires before the committed text is fully in the DOM.
    if (event.key === 'Enter' && event.keyCode === 229) {
      return
    }

    // Undo/redo before anything else — we own the stack (see useComposerUndo),
    // so these never reach Chromium's native history, which has no record of
    // the Range-based edits the rich editor makes.
    if (isUndoShortcut(event.nativeEvent)) {
      event.preventDefault()
      undo()

      return
    }

    if (isRedoShortcut(event.nativeEvent)) {
      event.preventDefault()
      redo()

      return
    }

    // Plain Backspace right after a directive chip: remove the chip + its
    // auto-inserted trailing space as one unit, so deleting a directive never
    // leaves an orphaned space. (Modified backspaces stay native.)
    if (
      event.key === 'Backspace' &&
      !event.metaKey &&
      !event.ctrlKey &&
      !event.altKey &&
      withUndoPoint(() => deleteChipBeforeCaret(event.currentTarget))
    ) {
      event.preventDefault()
      flushEditorToDraft(event.currentTarget)

      return
    }

    // Non-collapsed Backspace/Delete: native selection-delete is ~O(n²) on large
    // drafts (Ctrl+A → Delete froze ~1.3s). Collapsed carets fall through.
    if (
      (event.key === 'Backspace' || event.key === 'Delete') &&
      withUndoPoint(() => deleteSelectionInEditor(event.currentTarget))
    ) {
      event.preventDefault()
      flushEditorToDraft(event.currentTarget)

      return
    }

    // A typed link finished with a space chips like a pasted one — the space
    // itself rides along inside the insert.
    if (withUndoPoint(() => chipTypedUrlOnSpace(event))) {
      event.preventDefault()
      flushEditorToDraft(event.currentTarget)

      return
    }

    // Same for a bare `@path` — a hand-typed or Tab-descended path chips into
    // the `@file:`/`@folder:` ref it means, instead of submitting as plain text
    // the backend never resolves.
    if (withUndoPoint(() => chipTypedPathOnSpace(event))) {
      event.preventDefault()
      flushEditorToDraft(event.currentTarget)

      return
    }

    // Cmd/Ctrl+Shift+K drains the next queued message. Plain Cmd/Ctrl+K is
    // reserved for the global command palette.
    if ((event.metaKey || event.ctrlKey) && !event.altKey && event.shiftKey && event.key.toLowerCase() === 'k') {
      event.preventDefault()

      if (!busy) {
        void drainNextQueued()
      }

      return
    }

    // The popover is open but its items are still in flight (debounce + RPC).
    // Tab must not fall through to the browser — it would move focus out of
    // the composer mid-completion, which reads as the popover "eating" the
    // keypress. Swallow it; the refresh lands with the items.
    if (trigger && triggerLoading && triggerItems.length === 0 && event.key === 'Tab') {
      event.preventDefault()
      triggerKeyConsumedRef.current = true

      return
    }

    if (trigger && triggerItems.length > 0) {
      if (event.key === 'ArrowDown') {
        event.preventDefault()
        triggerKeyConsumedRef.current = true
        moveTriggerActive(1)

        return
      }

      if (event.key === 'ArrowUp') {
        event.preventDefault()
        triggerKeyConsumedRef.current = true
        moveTriggerActive(-1)

        return
      }

      // Accepting a completion: a no-arg command commits its directive chip,
      // an arg-taking command expands to its options step, and an arg option
      // commits the full `/cmd arg` chip. Space/Enter resolve the pick so a
      // leftover highlight does not replace a typed command; Tab still takes
      // the highlight.
      const accept = acceptsTriggerCompletion({
        activeExplicit: triggerActiveExplicit,
        freeTextArgStage: slashFreeTextArgStage,
        key: event.key,
        kind: trigger.kind,
        query: trigger.query
      })

      if (accept) {
        const itemTexts = triggerItems.map(item => {
          const meta = item.metadata as { command?: string; rawText?: string } | undefined

          return meta?.command || meta?.rawText || item.label
        })

        const item =
          trigger.kind === '/' && event.key !== 'Tab'
            ? triggerItems[
                implicitSlashAcceptIndex(trigger.query, itemTexts, triggerActive, triggerActiveExplicit) ?? -1
              ]
            : triggerItems[triggerActive]

        if (item) {
          event.preventDefault()
          triggerKeyConsumedRef.current = true
          // Tab means "go deeper" on a folder; Enter means "I want this one".
          replaceTriggerWithChip(item, { descend: event.key === 'Tab' })

          return
        }

        if (event.key === 'Tab') {
          event.preventDefault()
          triggerKeyConsumedRef.current = true

          return
        }
      }

      // Backspace climbs out of an `@` path one segment at a time, mirroring
      // Tab's one-key descent. Only when the caret sits at the end of the
      // token — mid-token editing keeps normal character deletion.
      if (event.key === 'Backspace' && !event.metaKey && !event.altKey && ascendTriggerPath()) {
        event.preventDefault()
        triggerKeyConsumedRef.current = true

        return
      }

      if (event.key === 'Escape') {
        event.preventDefault()
        triggerKeyConsumedRef.current = true
        closeTrigger()

        return
      }
    }

    // Arg stage with nothing left to suggest — a fully-typed arg the backend
    // completer no longer echoes (it drops the exact match), e.g.
    // `/personality creative`. Space/Tab still commit what's typed as a single
    // directive chip; Enter falls through to submit (send it as-is).
    if (
      trigger?.kind === '/' &&
      !triggerItems.length &&
      (event.key === ' ' || event.key === 'Tab') &&
      slashArgStage(trigger.query) &&
      trigger.query.trim()
    ) {
      if (commitTypedSlashDirective()) {
        event.preventDefault()
        triggerKeyConsumedRef.current = true

        return
      }
    }

    // ArrowUp/ArrowDown navigate, in priority order: the queue (edit entries in
    // place) then sent-message history. The history ring is derived from live
    // session messages each press — single source of truth, no mirror.
    if (event.key === 'ArrowUp') {
      // Decide from the live editor: the mirror is a frame behind typing or a
      // paste, and this branch can replace what the user just wrote.
      const currentDraft = liveComposerDraft(editorRef.current, draftRef.current)

      // Editing a queued turn → walk to the older entry.
      if (queueEdit && stepQueuedEdit(-1)) {
        event.preventDefault()
        triggerKeyConsumedRef.current = true

        return
      }

      // Empty composer + a queued turn → open the newest queued entry for edit
      // (the row's pencil), not a text recall. Enter saves it back to the queue.
      if (!currentDraft.trim() && !queueEdit && queuedPrompts.length > 0) {
        event.preventDefault()
        triggerKeyConsumedRef.current = true
        beginQueuedEdit(queuedPrompts[queuedPrompts.length - 1]!)

        return
      }

      // Don't hijack a typed draft unless already browsing — they'd lose it.
      if (currentDraft.trim() && !isBrowsingHistory(sessionId)) {
        return
      }

      event.preventDefault()
      triggerKeyConsumedRef.current = true

      // $messages is read imperatively (not subscribed) so the composer
      // doesn't re-render on every streaming delta flush.
      const history = deriveUserHistory(scope.$messages.get(), chatMessageText)
      const entry = browseBackward(sessionId, currentDraft, history)

      if (entry !== null) {
        loadIntoComposer(entry, scope.attachments.$attachments.get())
      }

      return
    }

    if (event.key === 'ArrowDown') {
      // Editing a queued turn → walk to the newer entry (past the newest exits).
      if (queueEdit) {
        event.preventDefault()
        triggerKeyConsumedRef.current = true
        stepQueuedEdit(1)

        return
      }

      // Browsing sent history → step toward the present, restoring the draft.
      if (isBrowsingHistory(sessionId)) {
        event.preventDefault()
        triggerKeyConsumedRef.current = true

        const history = deriveUserHistory(scope.$messages.get(), chatMessageText)
        const result = browseForward(sessionId, history)

        if (result !== null) {
          loadIntoComposer(result.text, scope.attachments.$attachments.get())
        }
      }

      return
    }

    // Cmd/Ctrl+Enter queues a follow-up while a turn runs. Plain Enter steers
    // a text-only draft, so both live-turn actions stay reachable by keyboard.
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey) && !event.shiftKey) {
      event.preventDefault()

      if (busy && !disabled) {
        // As with plain Enter, source the just-typed content from the DOM so a
        // fast keypress cannot queue a stale draft.
        const editorText = liveComposerDraft(editorRef.current, draftRef.current)

        if (editorText !== draftRef.current) {
          draftRef.current = editorText
          setComposerText(editorText)
        }

        queueDraft()
      }

      return
    }

    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()

      // Decide from the DOM, not React state. `hasComposerPayload` is derived
      // from the AUI composer state, which lags the latest keystroke by a
      // render, so on fast typing / IME the just-typed text isn't in state yet.
      // Without the live read, a real message typed while prompts are queued
      // would drain the queue instead of sending. submitDraft() re-syncs and
      // sends the live editor text.
      const editorText = liveComposerDraft(editorRef.current, draftRef.current)
      const hasLivePayload = editorText.trim().length > 0 || attachments.length > 0

      if (disabled) {
        return
      }

      if (!busy && !hasLivePayload && queuedPrompts.length > 0) {
        void drainNextQueued()

        return
      }

      // Empty Enter while busy. With prompts queued this is the double-send:
      // the first Enter put the words in the queue, a second sends them now
      // (promote + interrupt + drain on settle), mirroring the idle empty-Enter
      // drain above. With nothing queued it stays a no-op — interrupting is
      // explicit (Stop/Esc), never a stray Enter after sending. Gate on the live
      // DOM payload (not the render-lagged composer state) so a message typed
      // fast / via IME while busy still reaches submitDraft() and gets queued
      // instead of being mistaken for an empty Enter.
      if (busy && !hasLivePayload) {
        const head = queuedPrompts.find(entry => entry.id !== queueEdit?.entryId)

        if (head) {
          sendQueuedNow(head.id)
        }

        return
      }

      submitDraft()

      return
    }

    if (event.key === 'Escape') {
      // Editing a queued turn → Esc cancels the edit, restoring the prior draft.
      if (queueEdit) {
        event.preventDefault()
        exitQueuedEdit('cancel')

        return
      }

      // Otherwise Esc interrupts the running turn (Stop-button parity) — unless
      // the turn is parked waiting on the user, where Esc must not discard the
      // pending prompt. An explicit halt, so it parks the queue too.
      if (busy && !awaitingInput) {
        event.preventDefault()
        triggerHaptic('cancel')
        void Promise.resolve(haltRun())
      }
    }
  }

  const handleEditorKeyUp = triggerKeyUpHandler(triggerKeyConsumedRef, refreshTrigger)

  return {
    flushEditorToDraft,
    scheduleFlushEditorToDraft,
    handleEditorInput,
    handleEditorBeforeInput,
    handleCut,
    handlePaste,
    handleEditorKeyDown,
    handleEditorKeyUp
  }
}
