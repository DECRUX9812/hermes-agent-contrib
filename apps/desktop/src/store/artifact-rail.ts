import { atom, computed } from 'nanostores'

import {
  collectArtifactsForSession,
  type ArtifactRecord as TranscriptArtifact
} from '@/app/artifacts/artifact-utils'
import { SIDEBAR_COLLAPSE_MEDIA_QUERY } from '@/app/layout-constants'
import { PANE_TOGGLE_REVEAL_EVENT } from '@/components/pane-shell'
import { isPaneVisible, revealTreePane } from '@/components/pane-shell/tree/store'
import { getAllSessionMessages } from '@/hermes'
import { matchesQuery } from '@/hooks/use-media-query'
import { Codecs, persistentAtom } from '@/lib/persisted'
import { $artifactRegistry, type ArtifactRecord } from '@/store/artifacts'
import { modeBound } from '@/store/interface-mode'

import { $busy, $sessions, lineageAliases, sessionMatchesStoredId } from './session'
import { $focusedRuntimeId, $focusedSessionState, $focusedStoredSessionId } from './session-states'

// Per-session artifact rail (roadmap #32): one right-rail pane listing
// everything the focused session produced — generated artifacts from the
// registry ($artifactRegistry, live) joined with the transcript-scraped
// media/files/links the Artifacts page collects. Open previews in the right
// rail; the row action promotes the payload to a real file via the existing
// download/save plumbing. User-initiated only — the rail never opens itself.

// Must match the pane id registered in contrib/controller.
export const ARTIFACTS_PANE_ID = 'artifacts'

const OPEN_KEY = 'hermes.desktop.artifactsOpen'

const $artifactsOpenPref = persistentAtom(OPEN_KEY, false, Codecs.bool)

export const $artifactsOpen = modeBound('artifactsOpen', $artifactsOpenPref, open => $artifactsOpenPref.set(open))

/** One row in the rail. `registry` = generated code/html/svg artifact;
 *  `transcript` = a file/image/link scraped from the session's messages. */
export interface RailArtifactItem {
  id: string
  kind: 'artifact' | TranscriptArtifact['kind']
  label: string
  /** For display order (newest first). */
  timestamp: number
  registry?: ArtifactRecord
  transcript?: TranscriptArtifact
}

/** Merge the two artifact sources into the rail's flat, newest-first list. */
export function mergeRailArtifacts(
  registry: readonly ArtifactRecord[],
  transcript: readonly TranscriptArtifact[]
): RailArtifactItem[] {
  const items: RailArtifactItem[] = [
    ...registry.map(record => ({
      id: record.id,
      kind: 'artifact' as const,
      label: record.title || record.slug,
      registry: record,
      timestamp: record.updatedAt
    })),
    ...transcript.map(artifact => ({
      id: artifact.id,
      kind: artifact.kind,
      label: artifact.label || artifact.value,
      timestamp: artifact.timestamp,
      transcript: artifact
    }))
  ]

  return items.sort((a, b) => b.timestamp - a.timestamp)
}

/** Transcript artifacts for whichever session currently has focus (tile or
 *  primary). A persisted transcript is paged + scraped per read, so results
 *  are cached per session id; a rescan (refresh button, busy settle) re-reads. */
export const $railArtifacts = atom<TranscriptArtifact[]>([])
export const $railArtifactsLoading = atom(false)

const transcriptArtifactsCache = new Map<string, TranscriptArtifact[]>()

let railRefreshSeq = 0

export async function refreshArtifactRail({ rescan = false }: { rescan?: boolean } = {}): Promise<void> {
  const storedId = $focusedStoredSessionId.get()
  const seq = ++railRefreshSeq

  if (!storedId) {
    $railArtifacts.set([])
    $railArtifactsLoading.set(false)

    return
  }

  if (rescan) {
    transcriptArtifactsCache.delete(storedId)
  }

  const cached = transcriptArtifactsCache.get(storedId)

  if (cached) {
    if (seq === railRefreshSeq) {
      $railArtifacts.set(cached)
    }

    return
  }

  const session = $sessions.get().find(row => sessionMatchesStoredId(row, storedId))

  // No persisted row → nothing to scrape (registry artifacts still show).
  if (!session) {
    if (seq === railRefreshSeq) {
      $railArtifacts.set([])
    }

    return
  }

  $railArtifactsLoading.set(true)

  try {
    // Route through the session's owning connection + profile — a remote or
    // secondary-profile transcript isn't reachable on the primary socket.
    const { messages } = await getAllSessionMessages(storedId, {
      connectionId: session.connection_id,
      profile: session.profile
    })

    const found = collectArtifactsForSession(session, messages)

    transcriptArtifactsCache.set(storedId, found)

    if (seq === railRefreshSeq) {
      $railArtifacts.set(found)
    }
  } catch {
    // Over the safe-load limit or an unreachable backend: keep the last
    // derivation — the rail degrades, never hard-fails.
  } finally {
    if (seq === railRefreshSeq) {
      $railArtifactsLoading.set(false)
    }
  }
}

/** The rail's merged item list for the focused session: registry records may
 *  sit under any lineage alias (a compressed session re-keys them), so all
 *  aliases contribute. Transcript artifacts arrive via refreshArtifactRail. */
export const $railItems = computed(
  [$artifactRegistry, $railArtifacts, $focusedStoredSessionId, $focusedRuntimeId, $sessions],
  (registry, transcript, focusedId, focusedRuntime, sessions) => {
    const ids = new Set(focusedId ? lineageAliases(focusedId, sessions) : [])

    if (focusedRuntime) {
      ids.add(focusedRuntime)
    }

    const records = [...ids].flatMap(id => registry[id] ?? [])

    return mergeRailArtifacts(records, transcript)
  }
)

export function openArtifactsRail(): void {
  $artifactsOpen.set(true)
  void refreshArtifactRail()
}

export function closeArtifactsRail(): void {
  $artifactsOpen.set(false)
}

/** "Take me to the artifacts" — opens (never closes) the rail and fronts it.
 *  Narrow widths overlay the pane instead of docking, so the forced-reveal
 *  pin does the sliding there (same contract as the review pane). */
export function revealArtifactsRail(): void {
  const wasOpen = $artifactsOpen.get()

  openArtifactsRail()

  if (matchesQuery(SIDEBAR_COLLAPSE_MEDIA_QUERY)) {
    if (!wasOpen) {
      window.dispatchEvent(new CustomEvent(PANE_TOGGLE_REVEAL_EVENT, { detail: { id: ARTIFACTS_PANE_ID } }))
    }

    return
  }

  revealTreePane(ARTIFACTS_PANE_ID)
}

export function toggleArtifactsRail(): void {
  if (isPaneVisible(ARTIFACTS_PANE_ID)) {
    closeArtifactsRail()
  } else {
    revealArtifactsRail()
  }
}

// Refresh triggers: opening the rail, switching the focused session, and the
// focused session settling (busy → idle writes the transcript rows the scrape
// reads). All gated on the rail being open — a closed rail holds its cache.
$artifactsOpen.listen(open => {
  if (open) {
    void refreshArtifactRail()
  }
})

$focusedStoredSessionId.listen(() => {
  if ($artifactsOpen.get()) {
    void refreshArtifactRail()
  }
})

let railWasBusy = $focusedSessionState.get()?.busy ?? false

$focusedSessionState.listen(state => {
  const busy = state?.busy ?? false
  const settled = railWasBusy && !busy

  railWasBusy = busy

  if (settled && $artifactsOpen.get()) {
    void refreshArtifactRail({ rescan: true })
  }
})

// $busy covers the case where the focused tile's own busy flag hasn't flipped
// but the global one has (handoffs, background completions).
let railGlobalBusy = $busy.get()

$busy.listen(busy => {
  const settled = railGlobalBusy && !busy

  railGlobalBusy = busy

  if (settled && $artifactsOpen.get()) {
    void refreshArtifactRail({ rescan: true })
  }
})
