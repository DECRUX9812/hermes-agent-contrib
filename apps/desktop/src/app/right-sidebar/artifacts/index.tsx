import { useStore } from '@nanostores/react'
import { useCallback } from 'react'

import { type ArtifactRecord as TranscriptArtifact } from '@/app/artifacts/artifact-utils'
import { Button } from '@/components/ui/button'
import { Codicon } from '@/components/ui/codicon'
import { Tip } from '@/components/ui/tooltip'
import { useI18n } from '@/i18n'
import { artifactDownloadName } from '@/lib/artifact-detect'
import { downloadTextFile } from '@/lib/download-text'
import { normalizeOrLocalPreviewTarget } from '@/lib/local-preview'
import { downloadGatewayFileWithFeedback, isArtifactFilePath, isRemoteGateway } from '@/lib/media'
import { $railArtifactsLoading, $railItems, type RailArtifactItem, refreshArtifactRail } from '@/store/artifact-rail'
import { type ArtifactRecord, openArtifact } from '@/store/artifacts'
import { notifyError } from '@/store/notifications'
import { openPreview } from '@/store/preview'
import { $focusedStoredSessionId } from '@/store/session-states'

import { PaneEmptyState, RightSidebarSectionHeader } from '..'
import { SidebarPanelLabel } from '../../shell/sidebar-label'

const KIND_ICON: Record<RailArtifactItem['kind'], string> = {
  artifact: 'file-code',
  file: 'file',
  image: 'file-media',
  link: 'link'
}

const MIME_BY_KIND = { code: 'text/plain', html: 'text/html', svg: 'image/svg+xml' } as const

async function openTranscriptArtifact(artifact: TranscriptArtifact): Promise<void> {
  if (artifact.kind === 'link') {
    if (window.hermesDesktop?.openExternal) {
      await window.hermesDesktop.openExternal(artifact.href)
    } else {
      window.open(artifact.href, '_blank', 'noopener,noreferrer')
    }

    return
  }

  // A gateway-local file resolves to file:// in remote mode (the file lives on
  // the gateway, not this disk); opening locally fails — save it instead, the
  // same disposition the Artifacts page uses.
  if (isRemoteGateway() && isArtifactFilePath(artifact.value)) {
    await downloadGatewayFileWithFeedback(artifact.value, {
      profile: artifact.profile,
      sessionId: artifact.sessionId
    })

    return
  }

  const target = await normalizeOrLocalPreviewTarget(artifact.value)

  if (target) {
    openPreview(target)

    return
  }

  if (window.hermesDesktop?.openExternal) {
    await window.hermesDesktop.openExternal(artifact.href)
  } else {
    window.open(artifact.href, '_blank', 'noopener,noreferrer')
  }
}

async function saveTranscriptArtifact(artifact: TranscriptArtifact): Promise<void> {
  if (!isArtifactFilePath(artifact.value)) {
    return
  }

  await downloadGatewayFileWithFeedback(artifact.value, {
    profile: artifact.profile,
    sessionId: artifact.sessionId
  })
}

function saveRegistryArtifact(record: ArtifactRecord): void {
  const version = record.versions[record.versions.length - 1]

  if (!version) {
    return
  }

  downloadTextFile(
    artifactDownloadName(record.kind, record.language, record.title),
    version.content,
    MIME_BY_KIND[record.kind]
  )
}

function ArtifactRow({ item }: { item: RailArtifactItem }) {
  const { t } = useI18n()
  const a = t.artifactRail

  const record = item.registry
  const transcript = item.transcript

  const subtitle = record
    ? record.versions.length > 1
      ? `${t.artifactCard.kind[record.kind]} · ${t.artifactCard.versionBadge(record.versions.length)}`
      : t.artifactCard.kind[record.kind]
    : transcript?.kind === 'link'
      ? transcript.href
      : transcript?.value

  const open = useCallback(() => {
    if (record) {
      openArtifact(record.id)
    } else if (transcript) {
      openTranscriptArtifact(transcript).catch(error => notifyError(error, a.openFailed))
    }
  }, [a.openFailed, record, transcript])

  const promote = useCallback(() => {
    if (record) {
      saveRegistryArtifact(record)
    } else if (transcript) {
      saveTranscriptArtifact(transcript).catch(error => notifyError(error, a.saveFailed))
    }
  }, [a.saveFailed, record, transcript])

  // Links are URLs — there is no payload to promote to a file.
  const canPromote = Boolean(record) || (transcript ? transcript.kind !== 'link' : false)

  return (
    <div
      className="group/artifact-row row-hover flex h-6 cursor-pointer select-none items-center gap-1.5 rounded-md pr-1.5 pl-2 text-xs text-(--ui-text-secondary) hover:text-foreground"
      onClick={open}
      onKeyDown={event => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          open()
        }
      }}
      role="button"
      tabIndex={0}
    >
      <Codicon className="shrink-0" name={KIND_ICON[item.kind]} size="0.8rem" />
      <span className="flex min-w-0 flex-1 items-baseline gap-1.5">
        <span className="min-w-0 shrink truncate">{item.label}</span>
        {subtitle && (
          <span className="min-w-0 shrink-[9999] truncate text-[0.68rem] text-(--ui-text-tertiary)">{subtitle}</span>
        )}
      </span>

      <span className="hidden shrink-0 items-center gap-0.5 group-hover/artifact-row:flex">
        <Tip label={a.open}>
          <Button
            aria-label={a.open}
            className="size-4 rounded text-muted-foreground/70 hover:text-foreground"
            onClick={event => {
              event.stopPropagation()
              open()
            }}
            size="icon-xs"
            variant="ghost"
          >
            <Codicon name="eye" size="0.7rem" />
          </Button>
        </Tip>
        {canPromote && (
          <Tip label={a.saveToFile}>
            <Button
              aria-label={a.saveToFile}
              className="size-4 rounded text-muted-foreground/70 hover:text-foreground"
              onClick={event => {
                event.stopPropagation()
                promote()
              }}
              size="icon-xs"
              variant="ghost"
            >
              <Codicon name="cloud-download" size="0.7rem" />
            </Button>
          </Tip>
        )}
      </span>
    </div>
  )
}

/** Per-session artifact rail (roadmap #32): generated artifacts (registry) +
 *  transcript media/files/links (the Artifacts page's scrape) for the focused
 *  session, each previewable on click and promotable to a file. */
export function ArtifactsRailPane() {
  const { t } = useI18n()
  const a = t.artifactRail
  const items = useStore($railItems)
  const loading = useStore($railArtifactsLoading)
  const sessionId = useStore($focusedStoredSessionId)

  if (!sessionId) {
    return <PaneEmptyState label={a.noSession} />
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <RightSidebarSectionHeader>
        <div className="flex min-w-0 flex-1">
          <SidebarPanelLabel>{t.sidebar.artifacts}</SidebarPanelLabel>
        </div>
        <Tip label={t.common.refresh}>
          <Button
            aria-label={t.common.refresh}
            className="pointer-events-none opacity-0 transition-opacity focus-visible:pointer-events-auto focus-visible:opacity-100 group-focus-within/project-header:pointer-events-auto group-hover/project-header:pointer-events-auto group-hover/project-header:opacity-100 group-focus-within/project-header:opacity-100"
            disabled={loading}
            onClick={() => void refreshArtifactRail({ rescan: true })}
            size="icon-xs"
            variant="ghost"
          >
            <Codicon name="refresh" size="0.8125rem" spinning={loading} />
          </Button>
        </Tip>
      </RightSidebarSectionHeader>
      {items.length === 0 ? (
        loading ? (
          <div className="min-h-0 flex-1" />
        ) : (
          <PaneEmptyState label={a.empty} />
        )
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto py-1" role="list">
          {items.map(item => (
            <ArtifactRow item={item} key={item.id} />
          ))}
        </div>
      )}
    </div>
  )
}
