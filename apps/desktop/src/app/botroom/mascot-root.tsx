import type { BotRoomControl } from '@/store/botroom'

/**
 * Bot Room mascot window — `?win=botroom-mascot&bot=<id>&name=..&color=..`.
 *
 * One bot, one small always-on-top window, living on the desktop itself. The
 * window body is a native drag region (drag the mascot anywhere; clicks are
 * handled by the action dot + context menu so the drag region doesn't eat
 * them), and status arrives on the `hermes:botroom-mascot:state` channel.
 * Control verbs ride the shared `hermes:botroom:control` channel so the main
 * renderer's store handles them exactly like overlay controls.
 */
import { type MascotAction, OverlayScene } from './engine/mascot3d'
import { MASCOT_PILL_CSS } from './engine/styles'

const MASCOT_W = 150
const MASCOT_H = 165

interface BotRow {
  id: string
  name: string
  displayName?: string
  status?: string
  statusLine?: string
  color?: string
}

function esc(s: string): string {
  const d = document.createElement('div')
  d.textContent = s

  return d.innerHTML
}

export function mountBotRoomMascotWindow(host: HTMLElement): void {
  const params = new URLSearchParams(location.search)
  const botId = params.get('bot') ?? 'bot'
  const botName = decodeURIComponent(params.get('name') ?? botId)
  const botColor = decodeURIComponent(params.get('color') ?? '')

  const style = document.createElement('style')
  style.textContent = MASCOT_PILL_CSS
  document.head.appendChild(style)

  const stage = document.createElement('div')
  stage.className = 'hr-mw'
  stage.innerHTML = `
    <canvas class="hr-mw-canvas" width="${MASCOT_W}" height="${MASCOT_H}"></canvas>
    <div class="hr-mw-status" data-kind="idle"></div>
    <button class="hr-mw-dot" aria-label="Ask ${esc(botName)}"></button>
    <div class="hr-mw-name">${esc(botName)}</div>
    <div class="hr-mw-menu">
      <button data-act="task">Give task</button>
      <button data-act="dance">Dance</button>
      <button data-act="spin">Spin</button>
      <button data-act="celebrate">Celebrate</button>
      <button data-act="sleep">Sleep / wake</button>
    </div>`
  host.appendChild(stage)

  const canvas = stage.querySelector<HTMLCanvasElement>('.hr-mw-canvas')!
  const statusEl = stage.querySelector<HTMLElement>('.hr-mw-status')!
  const dot = stage.querySelector<HTMLButtonElement>('.hr-mw-dot')!
  const nameEl = stage.querySelector<HTMLElement>('.hr-mw-name')!
  const menu = stage.querySelector<HTMLElement>('.hr-mw-menu')!
  const scene = new OverlayScene(canvas)

  scene.add(botId, botName, MASCOT_W / 2, MASCOT_H / 2 + 12)

  const bridge = window.hermesDesktop
  const control = (payload: BotRoomControl) => bridge?.botroom?.control?.(payload)

  // The action dot is the one non-drag pixel — opens the task pill anchored
  // at this mascot. Everything else on the window body is -webkit-app-region:
  // drag, so native OS drag drives 'moved' → position persistence.
  dot.addEventListener('click', (e) => {
    e.stopPropagation()
    control({ type: 'open-pill', botId })
  })

  stage.addEventListener('contextmenu', (e) => {
    e.preventDefault()
    menu.classList.toggle('open')
  })

  menu.addEventListener('click', (e) => {
    const act = (e.target as HTMLElement).getAttribute('data-act')

    if (!act) {
      return
    }

    menu.classList.remove('open')

    const mascot = scene.get(botId)

    if (act === 'task') {
      control({ type: 'open-pill', botId })
    } else if (act === 'sleep') {
      mascot?.setWorking(false)
      mascot?.play('sleep', 1.4)
    } else if (act === 'dance' || act === 'spin' || act === 'celebrate') {
      mascot?.play(act as MascotAction, 1.2)
    }
  })

  document.addEventListener('click', (e) => {
    if (!menu.contains(e.target as Node)) {
      menu.classList.remove('open')
    }
  })

  // Window drag: the body captures the pointer and streams screen-space
  // positions to main, which repositions the window (native app-region drag
  // doesn't engage on a non-activating panel). The dot/menu are skipped so
  // clicks still reach them.
  let dragging = false

  stage.addEventListener('pointerdown', (e) => {
    const target = e.target as HTMLElement

    if (target.closest('.hr-mw-dot, .hr-mw-menu')) {
      return
    }

    dragging = true
    bridge?.botroomMascot?.drag?.({ botId, phase: 'start', x: e.screenX, y: e.screenY })
    e.preventDefault()
  })

  window.addEventListener('pointermove', (e) => {
    if (dragging) {
      bridge?.botroomMascot?.drag?.({ botId, phase: 'move', x: e.screenX, y: e.screenY })
    }
  })

  const endDrag = (e: PointerEvent) => {
    if (dragging) {
      dragging = false
      bridge?.botroomMascot?.drag?.({ botId, phase: 'end', x: e.screenX, y: e.screenY })
    }
  }

  window.addEventListener('pointerup', endDrag)
  window.addEventListener('pointercancel', endDrag)

  stage.addEventListener('mouseenter', () => nameEl.classList.add('show'))
  stage.addEventListener('mouseleave', () => {
    nameEl.classList.remove('show')
    menu.classList.remove('open')
  })

  if (botColor) {
    stage.style.setProperty('--hr-mw-accent', botColor)
  }

  // Roster state pushed from main (roster sync / bot.status).
  const off = bridge?.botroomMascot?.onState?.((bot: BotRow) => {
    if (!bot || bot.id !== botId) {
      return
    }

    if (bot.displayName) {
      nameEl.textContent = bot.displayName
      dot.title = `Ask ${bot.displayName}`
    }

    const kind = bot.status === 'working' ? 'working' : bot.status === 'sleeping' ? 'sleeping' : 'idle'
    statusEl.dataset.kind = kind
    statusEl.title = bot.statusLine ?? kind

    const mascot = scene.get(botId)

    if (mascot) {
      mascot.setWorking(bot.status === 'working')
    }
  })

  // Commanded performances — 'bot.action' pushes from the store (tasks
  // landing, room relays, scripts). Same verb set the extension uses.
  const offAction = bridge?.botroomMascot?.onAction?.((payload: { botId: string; action: string }) => {
    if (!payload || payload.botId !== botId) {
      return
    }

    const mascot = scene.get(botId)
    const action = payload.action as MascotAction

    if (action === 'point') {
      // Point straight ahead — the canvas has no element targets the way
      // the extension's page DOM does, so point reads as "attention here".
      mascot?.pointAt?.(MASCOT_W * 0.62, MASCOT_H * 0.35)
    } else {
      mascot?.play(action, 1.4)
    }
  })

  window.addEventListener('beforeunload', () => {
    off?.()
    offAction?.()
    scene.dispose()
  })
}
