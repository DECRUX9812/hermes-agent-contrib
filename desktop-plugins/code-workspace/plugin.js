/**
 * VS Code — Hermes Desktop plugin (iframe into code-server on the VM).
 *
 * Real, full VS Code served by code-server on the host VM
 * (Tailscale 127.0.0.1:8080) and embedded as a smooth pane in the Hermes
 * desktop app. All files are the VM's real filesystem; editing, IntelliSense,
 * themes, terminal, and extensions are genuine VS Code — not a reimplementation.
 *
 * Requirements:
 *   • code-server running on the VM (see README).
 *   • The desktop app (and this plugin) reachable to 127.0.0.1:8080 over
 *     Tailscale (laptop must be on the tailnet).
 */

import { useRef } from 'react'
import { jsx, jsxs } from 'react/jsx-runtime'

const ID = 'code-workspace'
const CODE_URL = 'http://127.0.0.1:8080'

function Pane() {
  const ref = useRef(null)
  const reload = () => { if (ref.current) ref.current.src = CODE_URL }
  return jsxs('div', {
    className: 'relative flex h-full flex-col bg-(--ui-bg,#0e0f14)',
    children: [
      jsx('div', {
        className: 'flex items-center gap-2 px-2 py-1 border-b border-(--ui-border) text-xs text-(--ui-text-secondary)',
        children: [
          jsx('span', { className: 'font-medium text-(--ui-text)', children: 'VS Code' }),
          jsx('span', { className: 'flex-1' }),
          jsx('button', { className: 'hover:text-(--ui-accent)', onClick: reload, title: 'Reload', children: '↻' }),
          jsx('a', { href: CODE_URL, target: '_blank', rel: 'noreferrer', className: 'hover:text-(--ui-accent)', title: 'Open in browser', children: '↗' })
        ]
      }),
      jsx('iframe', {
        ref,
        src: CODE_URL,
        className: 'flex-1 w-full border-0',
        style: { background: '#1e1e1e' },
        title: 'VS Code (code-server)',
        allow: 'autoplay; clipboard-read; clipboard-write; cross-origin-isolated; fullscreen; picture-in-picture'
      })
    ]
  })
}

export default {
  id: ID,
  name: 'VS Code',
  register(ctx) {
    ctx.register({
      id: 'pane',
      area: 'panes',
      title: 'Code',
      data: { placement: 'right', width: '720px' },
      render: Pane
    })
  }
}
