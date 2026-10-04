import { useStore } from '@nanostores/react'
import { type ReactNode, useEffect, useRef, useState } from 'react'

import { continueInHermesCli } from '@/app/right-sidebar/terminal/hermes-cli'
import { Button } from '@/components/ui/button'
import { Codicon } from '@/components/ui/codicon'
import { Tip } from '@/components/ui/tooltip'
import { useI18n } from '@/i18n'
import { isRemoteGateway } from '@/lib/media'
import { $codeServer, loadCodeServer } from '@/store/code-pane'
import { $currentCwd, $selectedStoredSessionId, $workspaceCwdOwner } from '@/store/session'

import { RightSidebarSectionHeader } from '..'
import { SidebarPanelLabel } from '../../shell/sidebar-label'

// The editor runs in its own partition: VS Code's cookies and storage never
// mix with the in-app browser's, and the preview guest preload never attaches.
const PARTITION = 'persist:hermes-vscode'

/** The project this chat works in, once the session has confirmed it (the same gate as the file tree). */
function useProjectFolder(): string {
  const cwd = useStore($currentCwd).trim()
  const selected = useStore($selectedStoredSessionId)
  const owner = useStore($workspaceCwdOwner)

  return cwd && (owner ?? null) === (selected ?? null) ? cwd : ''
}

function Editor({ url }: { url: string }) {
  const host = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = host.current

    if (!el) {
      return
    }

    const webview = document.createElement('webview')
    webview.className = 'flex h-full w-full flex-1'
    webview.setAttribute('partition', PARTITION)
    webview.setAttribute('webpreferences', 'contextIsolation=yes,nodeIntegration=no,sandbox=yes')
    webview.setAttribute('src', url)
    el.replaceChildren(webview)

    return () => webview.remove()
  }, [url])

  return <div className="flex min-h-0 flex-1 bg-(--ui-bg-secondary)" data-slot="code-editor" ref={host} />
}

function Notice({ action, body, icon, title }: { action?: ReactNode; body: string; icon: string; title: string }) {
  return (
    <div className="grid min-h-0 flex-1 place-items-center px-6 text-center">
      <div className="grid max-w-72 justify-items-center gap-2">
        <Codicon className="text-(--ui-text-quaternary)" name={icon} size="1.25rem" />
        <p className="text-[0.8125rem] font-medium text-foreground">{title}</p>
        <p className="text-[0.75rem] leading-relaxed text-(--ui-text-tertiary)">{body}</p>
        {action}
      </div>
    </div>
  )
}

/**
 * VS Code beside the chat: the user's own editor, served on this machine and
 * opened on the chat's project, with Hermes CLI one click away in the
 * terminal below. The agent edits, you edit, both see the same files.
 */
export function CodePane() {
  const { t } = useI18n()
  const c = t.codePane
  const folder = useProjectFolder()
  const server = useStore($codeServer)
  const sessionId = useStore($selectedStoredSessionId)
  const remote = isRemoteGateway()
  // Reload rebuilds the guest even when the URL is unchanged.
  const [reloads, setReloads] = useState(0)

  useEffect(() => {
    if (folder && !remote) {
      void loadCodeServer(folder)
    }
  }, [folder, remote])

  const name =
    folder
      .split(/[\\/]+/)
      .filter(Boolean)
      .pop() ?? folder

  const body = () => {
    if (remote) {
      return <Notice body={c.remoteBody} icon="remote" title={c.remoteTitle} />
    }

    if (!folder) {
      return <Notice body={c.noProjectBody} icon="folder" title={c.noProject} />
    }

    switch (server.status) {
      case 'ready':
        return <Editor key={reloads} url={server.url} />

      case 'missing':
        return (
          <Notice
            action={
              <Button onClick={() => void loadCodeServer(folder)} size="sm" variant="secondary">
                {c.retry}
              </Button>
            }
            body={c.missingBody}
            icon="vscode"
            title={c.missingTitle}
          />
        )

      case 'failed':
        return (
          <Notice
            action={
              <Button onClick={() => void loadCodeServer(folder)} size="sm" variant="secondary">
                {c.retry}
              </Button>
            }
            body={server.detail || c.failedBody}
            icon="warning"
            title={c.failedTitle}
          />
        )

      default:
        return <Notice body={c.startingBody} icon="loading~spin" title={c.starting} />
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-slot="code-pane">
      <RightSidebarSectionHeader>
        <div className="flex min-w-0 flex-1 items-baseline gap-2">
          <SidebarPanelLabel>{c.title}</SidebarPanelLabel>
          {folder ? <span className="truncate text-[0.6875rem] text-(--ui-text-quaternary)">{name}</span> : null}
        </div>
        <Tip label={c.cliHint}>
          <Button
            className="h-5 gap-1 px-1.5 text-[0.6875rem]"
            disabled={remote}
            onClick={() => void continueInHermesCli(sessionId, { cwd: folder || undefined })}
            size="xs"
            variant="ghost"
          >
            <Codicon name="terminal" size="0.7rem" />
            {c.cli}
          </Button>
        </Tip>
        {server.status === 'ready' ? (
          <Tip label={c.reload}>
            <Button
              aria-label={c.reload}
              className="size-5"
              onClick={() => setReloads(n => n + 1)}
              size="icon-xs"
              variant="ghost"
            >
              <Codicon name="refresh" size="0.7rem" />
            </Button>
          </Tip>
        ) : null}
      </RightSidebarSectionHeader>
      {body()}
    </div>
  )
}
