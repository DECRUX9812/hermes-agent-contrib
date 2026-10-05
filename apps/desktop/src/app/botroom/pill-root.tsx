/**
 * Bot Room task pill — `?win=botroom-pill&bot=<id>&name=..&color=..`.
 *
 * The small composer that opens next to a mascot window. It only exists
 * because the user explicitly opened it, so it is a focusable panel — first
 * click takes the keyboard (acceptFirstMouse), send/blur hands it back.
 * Sends ride the shared control channel — the main renderer's store routes
 * `task` to the bot exactly like the overlay's composer does.
 */
import { MASCOT_PILL_CSS } from './engine/styles'

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

export function mountBotRoomPillWindow(host: HTMLElement): void {
  const params = new URLSearchParams(location.search)
  const botId = params.get('bot') ?? 'bot'
  let botName = decodeURIComponent(params.get('name') ?? botId)
  const botColor = decodeURIComponent(params.get('color') ?? '')

  const style = document.createElement('style')
  style.textContent = MASCOT_PILL_CSS
  document.head.appendChild(style)

  const pill = document.createElement('div')
  pill.className = 'hr-pill'
  pill.innerHTML = `
    <div class="hr-pill-head">
      <span class="hr-pill-avatar">${esc(botName.slice(0, 1).toUpperCase())}</span>
      <span class="hr-pill-name">${esc(botName)}</span>
      <span class="hr-pill-status" data-kind="idle"></span>
    </div>
    <form class="hr-pill-form">
      <input class="hr-pill-input" placeholder="Ask ${esc(botName)}…" autocomplete="off" spellcheck="false" />
      <button class="hr-pill-send" type="submit" aria-label="Send">
        <svg viewBox="0 0 16 16" width="14" height="14"><path d="M2 8h10M8.5 3.5 13 8l-4.5 4.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
      </button>
    </form>`
  host.appendChild(pill)

  const input = pill.querySelector<HTMLInputElement>('.hr-pill-input')!
  const form = pill.querySelector<HTMLFormElement>('.hr-pill-form')!
  const statusEl = pill.querySelector<HTMLElement>('.hr-pill-status')!
  const nameEl = pill.querySelector<HTMLElement>('.hr-pill-name')!
  const avatarEl = pill.querySelector<HTMLElement>('.hr-pill-avatar')!
  const bridge = window.hermesDesktop

  if (botColor) {
    pill.style.setProperty('--hr-pill-accent', botColor)
  }

  // The window is focusable on click; the input focuses itself when shown
  // so typing starts immediately. On send/blur the OS hands keyboard back
  // to whatever app was frontmost.
  window.setTimeout(() => input.focus(), 80)

  form.addEventListener('submit', (e) => {
    e.preventDefault()

    const text = input.value.trim()

    if (!text) {
      return
    }

    bridge?.botroom?.control?.({ type: 'task', botId, text })
    input.value = ''
    statusEl.dataset.kind = 'working'
    input.blur()
  })

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      input.blur()
    }
  })

  const off = bridge?.botroomMascot?.onState?.((bot: BotRow) => {
    if (!bot || bot.id !== botId) {
      return
    }

    if (bot.displayName && bot.displayName !== botName) {
      botName = bot.displayName
      nameEl.textContent = bot.displayName
      avatarEl.textContent = bot.displayName.slice(0, 1).toUpperCase()
      input.placeholder = `Ask ${bot.displayName}…`
    }

    statusEl.dataset.kind = bot.status === 'working' ? 'working' : bot.status === 'sleeping' ? 'sleeping' : 'idle'
    statusEl.title = bot.statusLine ?? ''
  })

  window.addEventListener('beforeunload', () => off?.())
}
