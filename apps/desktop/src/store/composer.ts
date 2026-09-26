import { atom } from 'nanostores'

import { deriveDraftTitle } from '@/lib/draft-title'
import { triggerHaptic } from '@/lib/haptics'

/** Release blob: chip previews created for OS image drops (see #63682). */
export function revokeAttachmentPreviewUrl(url?: string | null) {
  if (url?.startsWith('blob:')) {
    try {
      URL.revokeObjectURL(url)
    } catch {
      // Best-effort — a revoked/invalid URL must not break chip removal.
    }
  }
}

/** Revoke blob: previews for attachments whose consumer was discarded. */
export function revokeAttachmentPreviewUrls(attachments: readonly ComposerAttachment[]) {
  for (const attachment of attachments) {
    revokeAttachmentPreviewUrl(attachment.previewUrl)
  }
}

/**
 * Revoke blob: previews from `previous` that are not retained by `next`.
 * Used when a queued/optimistic snapshot is replaced or dropped.
 */
export function revokeDiscardedAttachmentPreviews(
  previous: readonly ComposerAttachment[],
  next: readonly ComposerAttachment[] = []
) {
  const retained = new Set(
    next.map(attachment => attachment.previewUrl).filter((url): url is string => !!url?.startsWith('blob:'))
  )

  for (const attachment of previous) {
    const url = attachment.previewUrl

    if (url?.startsWith('blob:') && !retained.has(url)) {
      revokeAttachmentPreviewUrl(url)
    }
  }
}

export interface ClearAttachmentsOptions {
  /**
   * When true, leave blob: preview URLs alive for a submitted/queued snapshot
   * that still references them. Caller must revoke when that consumer is
   * discarded or replaced (see #63682 / PR review on #66546).
   */
  retainPreviewUrls?: boolean
}

export interface ComposerAttachment {
  id: string
  /** Renderer-lifetime identity for one attachment occurrence. Unlike `id`,
   * which is content/path-derived, this survives draft cloning but changes
   * when the user removes and re-adds the same attachment. */
  occurrenceId?: string
  kind: 'file' | 'folder' | 'image' | 'terminal' | 'url'
  label: string
  detail?: string
  refText?: string
  /** Legacy/on-demand full source. New local image chips omit this and read
   * `path` only when the lightbox opens, avoiding retained multi-MB base64. */
  previewUrl?: string
  /** Downscaled data URL for the attachment card and optimistic bubble only. */
  thumbnailUrl?: string
  path?: string
  /** Bounded source text from a Hermes-generated large paste, sent only to the title path. */
  titlePreview?: string
  attachedSessionId?: string
  /** Set while the file/image bytes are being staged into the session
   * workspace (remote upload or local stage), and 'error' if that failed.
   * Drives the spinner / error state on the composer attachment card. */
  uploadState?: 'uploading' | 'error'
}

export type ComposerAttachmentPatch = Partial<Omit<ComposerAttachment, 'id' | 'occurrenceId'>>

export const $composerDraft = atom('')
export const $composerAttachments = atom<ComposerAttachment[]>([])
export const $composerTerminalSelections = atom<Record<string, string>>({})

// Latched because opening a fresh session may remount the main composer before
// it can start voice. Session-tile composers deliberately never consume this.
export const $voiceConversationStartRequest = atom(0)
let nextVoiceStartRequest = 0
let handledVoiceStartRequest = 0
export const createComposerAttachmentOccurrenceId = (): string => crypto.randomUUID()

export const requestVoiceConversationStart = (): void => $voiceConversationStartRequest.set(++nextVoiceStartRequest)

export const takeVoiceConversationStart = (current: number): boolean => {
  if (current <= handledVoiceStartRequest) {
    return false
  }

  handledVoiceStartRequest = current

  return true
}

// ---------------------------------------------------------------------------
// Composer scopes — one live attachment set PER MOUNTED COMPOSER. The main
// chat's scope wraps the module-level atom above (all existing readers keep
// working); each session tile creates its own so two composers on screen
// never share chips. Draft text needs no scope: it lives in each ChatBar's
// DOM + draftRef and stashes per session key already.
// ---------------------------------------------------------------------------

export interface ComposerAttachmentScope {
  $attachments: ReturnType<typeof atom<ComposerAttachment[]>>
  add(attachment: ComposerAttachment): void
  clear(options?: ClearAttachmentsOptions): void
  remove(id: string): ComposerAttachment | null
  removeOccurrences(attachments: readonly ComposerAttachment[]): void
  setUploadState(id: string, uploadState?: ComposerAttachment['uploadState']): void
  update(attachment: ComposerAttachment): boolean
  updateIfCurrent(expected: ComposerAttachment, patch: ComposerAttachmentPatch): boolean
}

function attachmentOccurrenceIndex(attachments: ComposerAttachment[], expected: ComposerAttachment): number {
  return attachments.findIndex(item =>
    expected.occurrenceId === undefined
      ? item === expected
      : item.id === expected.id && item.occurrenceId === expected.occurrenceId
  )
}

export function createComposerAttachmentScope($attachments = atom<ComposerAttachment[]>([])): ComposerAttachmentScope {
  return {
    $attachments,
    add(attachment) {
      const previous = $attachments.get()
      const next = upsertAttachment(previous, attachment)
      $attachments.set(next)

      if (next.length > previous.length && attachment.kind !== 'url') {
        triggerHaptic('selection')
      }
    },
    clear(options) {
      if (!options?.retainPreviewUrls) {
        revokeAttachmentPreviewUrls($attachments.get())
      }

      $attachments.set([])
    },
    remove(id) {
      const current = $attachments.get()
      const removed = current.find(attachment => attachment.id === id) || null
      $attachments.set(current.filter(attachment => attachment.id !== id))
      revokeAttachmentPreviewUrl(removed?.previewUrl)

      return removed
    },
    removeOccurrences(attachments) {
      const current = $attachments.get()

      const submittedOccurrences = new Set(
        attachments
          .filter(attachment => attachment.occurrenceId !== undefined)
          .map(attachment => `${attachment.id}\u0000${attachment.occurrenceId}`)
      )

      const submittedLegacy = new Set(attachments.filter(attachment => attachment.occurrenceId === undefined))

      const next = current.filter(attachment =>
        attachment.occurrenceId === undefined
          ? !submittedLegacy.has(attachment)
          : !submittedOccurrences.has(`${attachment.id}\u0000${attachment.occurrenceId}`)
      )

      // Preserve clear()'s notification semantics even when no captured
      // occurrence remains. Some composer consumers settle local state on the
      // successful-submit store emission.
      $attachments.set(next)
    },
    setUploadState(id, uploadState) {
      const current = $attachments.get()
      const index = current.findIndex(attachment => attachment.id === id)

      if (index < 0) {
        return
      }

      const next = [...current]
      next[index] = { ...next[index]!, uploadState }
      $attachments.set(next)
    },
    update(attachment) {
      const current = $attachments.get()
      const index = current.findIndex(item => item.id === attachment.id)

      if (index < 0) {
        return false
      }

      const previous = current[index]
      const next = [...current]
      next[index] = attachment
      $attachments.set(next)

      if (previous?.previewUrl && previous.previewUrl !== attachment.previewUrl) {
        revokeAttachmentPreviewUrl(previous.previewUrl)
      }

      return true
    },
    updateIfCurrent(expected, patch) {
      const current = $attachments.get()
      const index = attachmentOccurrenceIndex(current, expected)

      if (index < 0) {
        return false
      }

      const next = [...current]
      next[index] = { ...next[index]!, ...patch }
      $attachments.set(next)

      return true
    }
  }
}

/** The main chat's scope — the module-level atom, so every existing
 *  `$composerAttachments` reader/writer IS this scope. */
export const mainComposerScope = createComposerAttachmentScope($composerAttachments)

// Per-thread draft stash for the decoupled composer. Session lifecycle never
// touches this — only ChatBar's scope swap reads/writes it. Text and
// path-backed chips mirror to localStorage; blobs and upload state don't.
export const SESSION_DRAFTS_STORAGE_KEY = 'hermes:composer-drafts:v4'
// Read once at load so drafts typed before the schema bump still restore.
const LEGACY_SESSION_DRAFTS_STORAGE_KEY = 'hermes:composer-drafts:v3'

export const NEW_SESSION_DRAFT_KEY = '__new__'
const MAX_PERSISTED_DRAFTS = 50
const EMPTY_SESSION_DRAFT: SessionDraft = { attachments: [], text: '' }

export interface SessionDraft {
  attachments: ComposerAttachment[]
  text: string
}

/** The chip fields that survive a reload: identity, kind, label, and the
 *  path/refText the preview and submit paths read. Blob kinds (image,
 *  terminal), upload state, previews, and per-session staging never persist. */
interface PersistedComposerAttachment {
  detail?: string
  id: string
  kind: 'file' | 'folder' | 'url'
  label: string
  path?: string
  refText?: string
}

interface PersistedSessionDraft {
  attachments?: PersistedComposerAttachment[]
  text: string
}

const serializeDraftAttachment = (attachment: ComposerAttachment): PersistedComposerAttachment | null =>
  attachment.kind === 'file' || attachment.kind === 'folder' || attachment.kind === 'url'
    ? {
        id: attachment.id,
        kind: attachment.kind,
        label: attachment.label,
        ...(attachment.detail ? { detail: attachment.detail } : {}),
        ...(attachment.path ? { path: attachment.path } : {}),
        ...(attachment.refText ? { refText: attachment.refText } : {})
      }
    : null

const restoreDraftAttachment = (value: unknown): ComposerAttachment | null => {
  const candidate = (typeof value === 'object' && value !== null ? value : {}) as Partial<ComposerAttachment>

  if (
    (candidate.kind !== 'file' && candidate.kind !== 'folder' && candidate.kind !== 'url') ||
    typeof candidate.id !== 'string' ||
    !candidate.id ||
    typeof candidate.label !== 'string'
  ) {
    return null
  }

  return {
    id: candidate.id,
    kind: candidate.kind,
    label: candidate.label,
    ...(typeof candidate.detail === 'string' ? { detail: candidate.detail } : {}),
    ...(typeof candidate.path === 'string' ? { path: candidate.path } : {}),
    ...(typeof candidate.refText === 'string' ? { refText: candidate.refText } : {})
  }
}

// The pre-session bucket keys on the profile the fresh chat would create on —
// the same owner chain session.create uses — so one profile's unsent text
// never surfaces in another's composer. profile.ts registers the resolver
// (importing it here would cycle the store graph); until then, 'default'.
let resolveNewDraftProfile: () => string = () => 'default'

export function registerComposerNewDraftProfileResolver(resolver: () => string): void {
  resolveNewDraftProfile = resolver
}

const newSessionDraftKey = (): string => {
  const key = `${NEW_SESSION_DRAFT_KEY}:${(resolveNewDraftProfile() || '').trim() || 'default'}`

  // A pre-profile payload's shared `__new__` entry folds into the resolved
  // bucket on first access — the only home its text can have now.
  const legacy = draftsBySession.get(NEW_SESSION_DRAFT_KEY)

  if (legacy) {
    const current = draftsBySession.get(key)
    const occupied = Boolean(current && (current.text.trim() || current.attachments.length > 0))

    draftsBySession.delete(NEW_SESSION_DRAFT_KEY)

    if (!occupied) {
      draftsBySession.set(key, legacy)
      publishDraftTitle(key, $draftTitles.get()[NEW_SESSION_DRAFT_KEY] || deriveDraftTitle(legacy.text))
    }

    publishDraftTitle(NEW_SESSION_DRAFT_KEY, '')
    persistDraftTexts()
  }

  return key
}

// `null`, empty, and the bare `__new__` sentinel all name the current
// profile's pre-session bucket; a literal `__new__:<profile>` key is an
// explicit reference to that profile's bucket (rename/delete sweeps).
const draftKey = (scope: string | null | undefined): string => {
  const key = scope?.trim()

  return !key || key === NEW_SESSION_DRAFT_KEY ? newSessionDraftKey() : key
}

/** Inline "Restored your unsent message" notice for the fresh draft (see
 *  `adoptGoneSessionDraft`). `null` = nothing to show. */
export interface RestoredDraftNotice {
  /** The dead stored-session key the text came from. */
  fromKey: string
  /** The text as restored — Undo only applies while the draft still equals it. */
  text: string
}

export const $restoredDraftNotice = atom<RestoredDraftNotice | null>(null)

const cloneDraft = (draft: SessionDraft): SessionDraft => ({
  attachments: draft.attachments.map(attachment => ({ ...attachment })),
  text: draft.text
})

function loadPersistedDraftTexts(): [string, SessionDraft][] {
  const decode = (raw: null | string): [string, SessionDraft][] => {
    try {
      if (!raw) {
        return []
      }

      // v3 payloads were key→text maps; v4 entries carry the persisted chips.
      const parsed = JSON.parse(raw) as Record<string, PersistedSessionDraft | string>

      return Object.entries(parsed).flatMap(([key, value]) => {
        const entry = typeof value === 'string' ? { text: value } : value
        const text = typeof entry?.text === 'string' ? entry.text : ''
        const stored = Array.isArray(entry?.attachments) ? entry.attachments : []

        const attachments = stored
          .map(restoreDraftAttachment)
          .filter((attachment): attachment is ComposerAttachment => attachment !== null)

        return text || attachments.length ? [[key, { attachments, text }]] : []
      })
    } catch {
      return []
    }
  }

  try {
    const entries = decode(window.localStorage.getItem(SESSION_DRAFTS_STORAGE_KEY))

    const legacyRaw = window.localStorage.getItem(LEGACY_SESSION_DRAFTS_STORAGE_KEY)

    if (legacyRaw !== null) {
      window.localStorage.removeItem(LEGACY_SESSION_DRAFTS_STORAGE_KEY)

      const seen = new Set(entries.map(([key]) => key))
      entries.push(...decode(legacyRaw).filter(([key]) => !seen.has(key)))
    }

    return entries
  } catch {
    return []
  }
}

const draftsBySession = new Map<string, SessionDraft>(loadPersistedDraftTexts())

// ---------------------------------------------------------------------------
// Row-drop staging — a file dropped on a session's sidebar ROW lands in that
// session's composer as chips without opening it. Two halves:
//   - `liveAttachmentScopes`: each mounted composer registers its attachment
//     scope under its draft key, so staging writes straight into the live set
//     (writing only the stash would be clobbered by that scope's next stash).
//   - `$draftAttachmentCounts`: staged count per draft key — backs the row's
//     "N attached" badge. Published by `stashSessionDraft` (the one funnel
//     every persist goes through) and by the live-scope listener so chip
//     edits repaint the badge between stash debounces.
// ---------------------------------------------------------------------------

const liveAttachmentScopes = new Map<string, ComposerAttachmentScope>()

export const $draftAttachmentCounts = atom<Record<string, number>>(
  Object.fromEntries(
    [...draftsBySession]
      .map(([key, draft]) => [key, draft.attachments.length] as const)
      .filter(([, count]) => count > 0)
  )
)

function publishDraftAttachmentCount(key: string, count: number): void {
  const current = $draftAttachmentCounts.get()

  if ((current[key] ?? 0) === count) {
    return
  }

  const next = { ...current }

  if (count > 0) {
    next[key] = count
  } else {
    delete next[key]
  }

  $draftAttachmentCounts.set(next)
}

/** Staged count for one draft scope — the session row badge's selector. */
export const draftAttachmentCountIn = (
  counts: Record<string, number>,
  scope: string | null | undefined
): number => counts[draftKey(scope)] ?? 0

/**
 * Publish a mounted composer's live attachment set under its draft scope.
 * Returns the unregister. On unregister the stash count is republished — the
 * composer's own layout cleanup stashes before this passive cleanup runs, so
 * the count cannot bounce back to a pre-stash value.
 */
export function registerComposerAttachmentScope(
  scope: string | null | undefined,
  attachments: ComposerAttachmentScope
): () => void {
  const key = draftKey(scope)
  liveAttachmentScopes.set(key, attachments)
  publishDraftAttachmentCount(key, attachments.$attachments.get().length)

  const unlisten = attachments.$attachments.listen(list => publishDraftAttachmentCount(key, list.length))

  return () => {
    unlisten()

    if (liveAttachmentScopes.get(key) === attachments) {
      liveAttachmentScopes.delete(key)
    }

    publishDraftAttachmentCount(key, draftsBySession.get(key)?.attachments.length ?? 0)
  }
}

/**
 * Stage attachment chips into a session's draft without opening it. When a
 * composer is mounted for the key the chips land in its live set (its normal
 * stash keeps them); the stash merge always runs too, covering both the
 * unmounted case and a mounted composer between stash beats. Returns the
 * merged count.
 */
export function stageSessionDraftAttachments(
  scope: string | null | undefined,
  additions: readonly ComposerAttachment[]
): number {
  const key = draftKey(scope)
  const live = liveAttachmentScopes.get(key)
  const base = live?.$attachments.get() ?? draftsBySession.get(key)?.attachments ?? []
  const merged = additions.reduce((list, attachment) => upsertAttachment(list, { ...attachment }), base)

  live?.$attachments.set(merged)
  stashSessionDraft(key, draftsBySession.get(key)?.text ?? '', merged)

  return merged.length
}

/**
 * Patch one asynchronous attachment occurrence wherever the main composer owns
 * it. During a session switch the occurrence moves from the live atom into the
 * per-session in-memory draft stash; a preview may finish on either side of
 * that handoff. Updating both stores is safe because occurrence ids are unique,
 * and merging into the latest object preserves concurrent staging metadata.
 */
export function patchMainComposerAttachmentOccurrence(
  expected: ComposerAttachment,
  patch: ComposerAttachmentPatch
): boolean {
  let updated = mainComposerScope.updateIfCurrent(expected, patch)

  for (const [key, draft] of draftsBySession) {
    const index = attachmentOccurrenceIndex(draft.attachments, expected)

    if (index < 0) {
      continue
    }

    const attachments = [...draft.attachments]
    attachments[index] = { ...attachments[index]!, ...patch }
    draftsBySession.set(key, { ...draft, attachments })
    updated = true
  }

  return updated
}

/**
 * What each unsent draft would be called, keyed the same way its text is.
 *
 * A draft has no session to carry a title, so the tab showing it reads this
 * instead of the "New session" placeholder. Written from `stashSessionDraft`,
 * the one funnel every composer's text already flows through — the debounce
 * that persists a draft is the same beat that renames its tab, so typing costs
 * nothing extra. Only tabs showing a draft subscribe, and each selects its own
 * key, so a rename repaints one label rather than the strip.
 *
 * Seeded from the persisted texts: a draft left open across a restart comes
 * back already named.
 */
export const $draftTitles = atom<Record<string, string>>(
  Object.fromEntries(
    [...draftsBySession].map(([key, draft]) => [key, deriveDraftTitle(draft.text)]).filter(([, title]) => title)
  )
)

/** Read one draft's title out of the map — for a `useStoreSelector`, so a tab
 *  repaints on its OWN rename rather than on every draft's. */
export const draftTitleIn = (titles: Record<string, string>, scope: string | null | undefined): string =>
  titles[draftKey(scope)] ?? ''

export const draftTitleFor = (scope: string | null | undefined): string => draftTitleIn($draftTitles.get(), scope)

function publishDraftTitle(key: string, title: string): void {
  const current = $draftTitles.get()

  if ((current[key] ?? '') === title) {
    return
  }

  const next = { ...current }

  if (title) {
    next[key] = title
  } else {
    delete next[key]
  }

  $draftTitles.set(next)
}

/**
 * Re-read the persisted drafts written by ANOTHER window into this one's map.
 *
 * Drafts are per-renderer state backed by shared localStorage, and the map
 * above is read exactly once at module load. Two windows on the same session
 * (HUD mode ⇄ the app window) therefore diverge the moment either one types:
 * whichever window mounted first keeps its stale copy forever, so text typed
 * in the HUD is simply gone when you return to the app.
 *
 * Merge, don't clobber — the local map may hold attachments (never persisted)
 * that the incoming text-only snapshot can't know about.
 */
export function reloadPersistedDrafts(): void {
  const incoming = new Map(loadPersistedDraftTexts())

  for (const [key, draft] of incoming) {
    const local = draftsBySession.get(key)
    draftsBySession.set(key, local?.attachments.length ? { ...local, text: draft.text } : draft)
    publishDraftTitle(key, deriveDraftTitle(draft.text))
    publishDraftAttachmentCount(key, draftsBySession.get(key)?.attachments.length ?? 0)
  }

  // A key that vanished from storage was cleared (sent) in the other window.
  for (const key of [...draftsBySession.keys()]) {
    if (!incoming.has(key)) {
      draftsBySession.delete(key)
      publishDraftTitle(key, '')
      publishDraftAttachmentCount(key, 0)
    }
  }
}

// localStorage `storage` events fire across Electron BrowserWindows of the
// same origin, so the other window's write is the sync signal.
if (typeof window !== 'undefined') {
  window.addEventListener('storage', event => {
    if (event.key === SESSION_DRAFTS_STORAGE_KEY) {
      reloadPersistedDrafts()
    }
  })
}

/**
 * Push a composer's live text into the shared stash (`flush`), or repaint it
 * from the stash (`reload`).
 *
 * Both halves of the HUD handoff need this. The stash is the only draft state
 * two windows share, but a mounted composer only consults it when its session
 * scope changes — so entering HUD mode has to flush the app window's in-editor
 * text down to the stash before the HUD boots and reads it, and leaving has to
 * repaint the app's editor from whatever the HUD left behind (usually empty,
 * because the HUD sent it).
 *
 * Dispatched synchronously, unlike the focus bus: the flush must complete
 * before the HUD window is created.
 */
const DRAFT_SYNC_EVENT = 'hermes:composer-draft-sync'

export type ComposerDraftSyncMode = 'flush' | 'reload'

interface ComposerDraftSyncDetail {
  mode: ComposerDraftSyncMode
  target: string
}

export function requestComposerDraftSync(mode: ComposerDraftSyncMode, target = 'main'): void {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent<ComposerDraftSyncDetail>(DRAFT_SYNC_EVENT, { detail: { mode, target } }))
  }
}

export function onComposerDraftSyncRequest(handler: (detail: ComposerDraftSyncDetail) => void): () => void {
  if (typeof window === 'undefined') {
    return () => undefined
  }

  const listener = (event: Event) => handler((event as CustomEvent<ComposerDraftSyncDetail>).detail)
  window.addEventListener(DRAFT_SYNC_EVENT, listener)

  return () => window.removeEventListener(DRAFT_SYNC_EVENT, listener)
}

function persistDraftTexts() {
  try {
    const entries = [...draftsBySession]
      .filter(([, draft]) => draft.text || draft.attachments.length > 0)
      .slice(-MAX_PERSISTED_DRAFTS)
      .map(([key, draft]) => {
        const attachments = draft.attachments
          .map(serializeDraftAttachment)
          .filter((attachment): attachment is PersistedComposerAttachment => attachment !== null)

        return [key, { attachments, text: draft.text }] as const
      })

    if (entries.length === 0) {
      window.localStorage.removeItem(SESSION_DRAFTS_STORAGE_KEY)
    } else {
      window.localStorage.setItem(SESSION_DRAFTS_STORAGE_KEY, JSON.stringify(Object.fromEntries(entries)))
    }
  } catch {
    // Best-effort only — quota/private-mode must never break typing.
  }
}

export function stashSessionDraft(scope: string | null | undefined, text: string, attachments: ComposerAttachment[]) {
  const key = draftKey(scope)

  // Delete-then-set keeps MRU order for MAX_PERSISTED_DRAFTS eviction.
  draftsBySession.delete(key)

  if (text.trim() || attachments.length > 0) {
    draftsBySession.set(key, cloneDraft({ attachments, text }))
  } else if (key === newSessionDraftKey()) {
    // The fresh draft was sent or emptied — a restore notice has nothing left
    // to undo.
    $restoredDraftNotice.set(null)
  }

  persistDraftTexts()
  publishDraftTitle(key, deriveDraftTitle(text))
  publishDraftAttachmentCount(key, draftsBySession.get(key)?.attachments.length ?? 0)
}

export function takeSessionDraft(scope: string | null | undefined): SessionDraft {
  const stashed = draftsBySession.get(draftKey(scope))

  return stashed ? cloneDraft(stashed) : EMPTY_SESSION_DRAFT
}

export const clearSessionDraft = (scope: string | null | undefined) => stashSessionDraft(scope, '', [])

/**
 * Move a stashed composer draft from one session key onto another.
 *
 * Auto-compression rotates the live stored tip id (root → continuation) while
 * the user may still be typing. Drafts keyed on the obsolete tip would otherwise
 * vanish from the composer when selection follows the new tip. A new chat is
 * stored under the pre-session key until its first session id arrives. No-op
 * unless the destination resolves, the keys differ, and the source has content. Does not overwrite a
 * non-empty destination draft.
 */
export function migrateSessionDraft(fromKey: string | null | undefined, toKey: string | null | undefined): boolean {
  const from = draftKey(fromKey)
  const to = draftKey(toKey)

  if (!toKey?.trim() || from === to) {
    return false
  }

  const source = draftsBySession.get(from)

  if (!source || (!source.text.trim() && source.attachments.length === 0)) {
    return false
  }

  const dest = draftsBySession.get(to)

  if (dest && (dest.text.trim() || dest.attachments.length > 0)) {
    return false
  }

  stashSessionDraft(toKey, source.text, source.attachments)
  clearSessionDraft(fromKey)

  return true
}

/**
 * A profile rename carries its `__new__:<name>` fresh-draft bucket to the new
 * name. `migrateSessionDraft` never clobbers a non-empty destination; the old
 * key is dropped either way so a later same-name profile inherits nothing.
 */
export function migrateComposerDraftsForProfile(from: string, to: string): void {
  const oldKey = `${NEW_SESSION_DRAFT_KEY}:${from}`

  if (migrateSessionDraft(oldKey, `${NEW_SESSION_DRAFT_KEY}:${to}`)) {
    return
  }

  if (draftsBySession.delete(oldKey)) {
    publishDraftTitle(oldKey, '')
    publishDraftAttachmentCount(oldKey, 0)
    persistDraftTexts()
  }
}

/**
 * Drop the deleted profile's fresh-draft bucket. Local deletes only: the
 * bucket keys on the profile name alone, so a remote connection's delete
 * can't be told apart from a same-named local profile and leaves it alone.
 */
export function dropComposerDraftsForProfile(
  profile: string,
  route?: { connectionId?: string; profile?: string; targetProfile?: string }
): void {
  if ((String(route?.connectionId ?? '').trim() || 'local') !== 'local') {
    return
  }

  const key = `${NEW_SESSION_DRAFT_KEY}:${profile}`

  if (!draftsBySession.delete(key)) {
    return
  }

  publishDraftTitle(key, '')
  publishDraftAttachmentCount(key, 0)
  persistDraftTexts()
}

/**
 * The stored id the pre-session chat is about to be re-homed onto, announced
 * by the site that assigns it (first-send `session.create`, cold-start
 * resume-last-session) and consumed by the composer's scope swap.
 *
 * The swap cannot tell an assignment apart from the user opening another
 * session from a new chat — both flip the scope from the `__new__` bucket to
 * a concrete id — and only the assignment may carry the draft along: a
 * sidebar click keeps per-scope drafts where they were typed.
 */
let announcedNewSessionDraftKey: string | null = null

export function announceNewSessionDraftKey(toKey: string | null | undefined): void {
  announcedNewSessionDraftKey = toKey?.trim() || null
}

/** Consume the announcement; move the `__new__` draft when it names `toKey`. */
export function adoptNewSessionDraft(toKey: string | null | undefined): boolean {
  const announced = announcedNewSessionDraftKey
  announcedNewSessionDraftKey = null

  if (!announced || announced !== toKey?.trim()) {
    return false
  }

  if (draftsBySession.has(draftKey(null))) {
    return migrateSessionDraft(null, toKey)
  }

  // A profile re-aim mid-typing stashes the text under a different profile's
  // bucket than the send resolves — the draft still belongs to the send, so
  // take whichever fresh bucket holds it.
  const other = [...draftsBySession.keys()].find(key => key.startsWith(NEW_SESSION_DRAFT_KEY))

  return !!other && migrateSessionDraft(other, toKey)
}

/**
 * Recovery for the unsent text of a session that turned out to be GONE
 * (#111868): deleted, or a stale id from a wiped / renamed backend.
 *
 * The resume path already drops such a window to a fresh draft without
 * toasting or looping (62af32efe7c, bounded by `goneSessionVerdict`). The
 * composer's draft stash is keyed per stored session, so the text the user
 * typed into the dead id is not lost — but nothing will ever open that key
 * again, so it is invisible. The gone verdict announces the dead key here;
 * the composer's scope swap (concrete id → the `__new__` bucket) consumes
 * it AFTER the outgoing cleanup stashed the live editor text, so even
 * keystrokes still inside the persist debounce ride along.
 *
 * Offer, don't hijack: the fresh draft is seeded and an inline notice with
 * Undo is published — no navigation, no focus steal, no toast. Fires once:
 * the source key is cleared by the move, so re-opening the dead id later
 * finds nothing to restore.
 */
let announcedGoneSessionDraftKey: string | null = null

export function announceGoneSessionDraft(fromKey: string | null | undefined): void {
  announcedGoneSessionDraftKey = fromKey?.trim() || null
}

/**
 * Consume the announcement when a composer enters the fresh-draft scope.
 * Moves the dead key's draft into the `__new__` bucket and publishes the
 * notice. Declines (no notice) when nothing was announced, the key holds no
 * text, or the user is already composing a new chat — never clobber what
 * they are typing. Keyed on the announcement, not on the composer observing
 * an id → fresh transition: the composer can remount across the drop (a
 * loading route mounts no composer), so the dead scope may never have been
 * this instance's previous scope.
 */
export function adoptGoneSessionDraft(): boolean {
  const announced = announcedGoneSessionDraftKey
  announcedGoneSessionDraftKey = null

  if (!announced) {
    return false
  }

  const source = draftsBySession.get(draftKey(announced))

  if (!source?.text.trim()) {
    return false
  }

  const dest = draftsBySession.get(newSessionDraftKey())

  if (dest && (dest.text.trim() || dest.attachments.length > 0)) {
    return false
  }

  const { attachments, text } = source
  stashSessionDraft(null, text, attachments)
  clearSessionDraft(announced)
  $restoredDraftNotice.set({ fromKey: announced, text })

  return true
}

export function dismissRestoredDraftNotice(): void {
  $restoredDraftNotice.set(null)
}

/**
 * Undo the restore: put the text back under the dead key (where it was,
 * still recoverable by the same path) and empty the fresh draft. Only while
 * the live text is still exactly what was restored — once the user has
 * edited it, Undo would destroy their work, so it only dismisses the notice.
 * Returns whether the fresh draft was emptied (the caller repaints).
 */
export function undoRestoredDraft(liveText: string): boolean {
  const notice = $restoredDraftNotice.get()
  $restoredDraftNotice.set(null)

  if (!notice || liveText !== notice.text) {
    return false
  }

  const current = draftsBySession.get(newSessionDraftKey())
  stashSessionDraft(notice.fromKey, notice.text, current?.attachments ?? [])
  clearSessionDraft(null)

  return true
}

export function setComposerDraft(value: string) {
  $composerDraft.set(value)
}

export function appendComposerDraft(value: string) {
  const text = value.trim()

  if (!text) {
    return
  }

  const current = $composerDraft.get()
  const separator = current && !current.endsWith('\n') ? '\n\n' : ''

  $composerDraft.set(`${current}${separator}${text}`)
}

export function appendComposerInline(value: string) {
  const text = value.trim()

  if (!text) {
    return
  }

  const current = $composerDraft.get().trimEnd()
  const separator = current ? ' ' : ''

  $composerDraft.set(`${current}${separator}${text}`)
}

export function clearComposerDraft() {
  $composerDraft.set('')
}

// Main-scope conveniences — the names the app has always used.
export const addComposerAttachment = (attachment: ComposerAttachment) => mainComposerScope.add(attachment)
export const removeComposerAttachment = (id: string) => mainComposerScope.remove(id)

/** Replace an existing attachment in place by id. No-op (returns false) when the
 * id is gone — e.g. the user removed the chip while an eager upload was still in
 * flight, so a late success must NOT resurrect it. Use this instead of
 * addComposerAttachment for async results that may land after a removal. */
export const updateComposerAttachment = (attachment: ComposerAttachment) => mainComposerScope.update(attachment)

export const clearComposerAttachments = () => mainComposerScope.clear()

/** Update only the upload state of an existing attachment (no-op if it's gone,
 * e.g. the user removed it mid-upload). Pass `undefined` to clear it. */
export const setComposerAttachmentUploadState = (id: string, uploadState?: ComposerAttachment['uploadState']) =>
  mainComposerScope.setUploadState(id, uploadState)

const TERMINAL_REF_RE = /@terminal:(`[^`\n]+`|"[^"\n]+"|'[^'\n]+'|\S+)/g

function unquoteRefValue(raw: string) {
  const head = raw[0]
  const tail = raw[raw.length - 1]
  const quoted = (head === '`' && tail === '`') || (head === '"' && tail === '"') || (head === "'" && tail === "'")

  return (quoted ? raw.slice(1, -1) : raw).replace(/[,.;!?]+$/, '').trim()
}

function terminalLabelsFromDraft(draft: string) {
  const labels: string[] = []
  const seen = new Set<string>()

  for (const match of draft.matchAll(TERMINAL_REF_RE)) {
    const label = unquoteRefValue(match[1] || '')

    if (!label || seen.has(label)) {
      continue
    }

    seen.add(label)
    labels.push(label)
  }

  return labels
}

export function setComposerTerminalSelection(label: string, text: string) {
  const nextLabel = label.trim()
  const nextText = text.trim()

  if (!nextLabel || !nextText) {
    return
  }

  const current = $composerTerminalSelections.get()

  if (current[nextLabel] === nextText) {
    return
  }

  $composerTerminalSelections.set({
    ...current,
    [nextLabel]: nextText
  })
}

export function reconcileComposerTerminalSelections(draft: string) {
  const current = $composerTerminalSelections.get()
  const labels = new Set(terminalLabelsFromDraft(draft))
  let changed = false
  const next: Record<string, string> = {}

  for (const [label, text] of Object.entries(current)) {
    if (!labels.has(label)) {
      changed = true

      continue
    }

    next[label] = text
  }

  if (changed) {
    $composerTerminalSelections.set(next)
  }
}

export function terminalContextBlocksFromDraft(draft: string) {
  const labels = terminalLabelsFromDraft(draft)

  if (labels.length === 0) {
    return []
  }

  const selections = $composerTerminalSelections.get()

  return labels.flatMap(label => {
    const text = selections[label]?.trim()

    if (!text) {
      return []
    }

    return `\`\`\`terminal\n${text}\n\`\`\``
  })
}

export function clearComposerTerminalSelections() {
  if (Object.keys($composerTerminalSelections.get()).length === 0) {
    return
  }

  $composerTerminalSelections.set({})
}

function upsertAttachment(attachments: ComposerAttachment[], attachment: ComposerAttachment) {
  const index = attachments.findIndex(item => item.id === attachment.id)

  if (index < 0) {
    return [...attachments, attachment]
  }

  const previous = attachments[index]
  const next = [...attachments]
  next[index] = attachment

  if (previous?.previewUrl && previous.previewUrl !== attachment.previewUrl) {
    revokeAttachmentPreviewUrl(previous.previewUrl)
  }

  return next
}
