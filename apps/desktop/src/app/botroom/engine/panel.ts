import { faceDataUrl } from './face'
import { renderBody, renderMirror } from './mdlite'
import type { Bot, RoomMsg } from './types'

interface SpeechRecognitionLike {
  continuous: boolean
  interimResults: boolean
  lang: string
  onstart: (() => void) | null
  onend: (() => void) | null
  onresult: ((e: SpeechRecognitionEventLike) => void) | null
  onerror: ((e?: { error?: string }) => void) | null
  start(): void
  stop(): void
  abort(): void
}
interface SpeechRecognitionEventLike {
  results: ArrayLike<ArrayLike<{ transcript: string }>>
}
type SpeechRecognitionCtor = new () => SpeechRecognitionLike

export interface PanelHooks {
  onSend(text: string, target?: ElementInfo): void
  onClose(): void
}

export interface ElementInfo {
  selector: string
  label: string
}

const STATUS_COLOR: Record<string, string> = {
  idle: '#3dd68c',
  working: '#ffb224',
  stalled: '#ff7849',
  offline: '#6b7280',
  sleeping: '#8b93b0',
}

const logs = new Map<string, { who: string; text: string; kind: 'user' | 'bot' | 'sys' }[]>()

/** Self-ticking elapsed readout — mutates its own text node once a second
 *  instead of going through any render path (OpenMausBot WorkingTimer). */
function fmtElapsed(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))

  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`
}

export class Panel {
  el: HTMLElement
  private logEl: HTMLElement
  private input: HTMLTextAreaElement
  private target: ElementInfo | null = null
  private targetChip: HTMLElement
  private mic: HTMLElement
  private statusEl: HTMLElement
  private mirror: HTMLElement
  private readonly mentions = new Set<string>()
  private typingTimers = new Map<string, number>()
  private clearedAt = new Map<string, number>()
  private recognizing = false
  private rec: SpeechRecognitionLike | null = null

  constructor(
    private scope: ShadowRoot | HTMLElement,
    private key: string,
    title: string,
    color: string,
    status: string,
    private hooks: PanelHooks,
    avatar?: string,
  ) {
    this.el = document.createElement('div')
    this.el.className = 'hr-panel'

    const avatarHtml = avatar
      ? `<img class="hr-avatar" alt=""/>`
      : `<span class="hr-avatar hr-avatar-txt" style="background:${color}33;border:1px solid ${color}66;color:${color}">${title.slice(0, 1).toUpperCase()}</span>`

    this.el.innerHTML = `
      <div class="hr-panel-head">
        ${avatarHtml}
        <div class="hr-meta">
          <div class="hr-title"></div>
          <div class="hr-status"><span class="hr-dot" style="background:${STATUS_COLOR[status] ?? '#6b7280'};color:${STATUS_COLOR[status] ?? '#6b7280'}"></span><span class="hr-status-txt"></span></div>
        </div>
        <button class="hr-panel-x" title="Close">✕</button>
      </div>
      <div class="hr-panel-log"></div>
      <div class="hr-target-chip" style="display:none">
        <span>◎</span><span class="hr-target-label"></span><span class="hr-x">✕</span>
      </div>
      <div class="hr-composer">
        <div class="hr-compose-pill">
          <div class="hr-field"><div class="hr-mirror" aria-hidden="true"></div><textarea rows="1" placeholder="Give ${title} a task…"></textarea></div>
          <button class="hr-btn mic" title="Speak">🎙</button>
          <button class="hr-btn send" title="Send">➤</button>
        </div>
      </div>`
    const av = this.el.querySelector<HTMLImageElement>('img.hr-avatar')

    if (av && avatar) {av.src = avatar}
    this.el.querySelector('.hr-title')!.textContent = title
    this.statusEl = this.el.querySelector('.hr-status-txt')!
    this.statusEl.textContent = status
    this.logEl = this.el.querySelector('.hr-panel-log')!
    this.input = this.el.querySelector('textarea')!
    this.mirror = this.el.querySelector('.hr-mirror')!
    this.targetChip = this.el.querySelector('.hr-target-chip')!
    this.mic = this.el.querySelector('.hr-btn.mic')!

    this.el.querySelector('.hr-panel-x')!.addEventListener('click', () => this.close())
    // Real-mouse focus can get eaten between the drag handlers on mascot
    // hit-rects and the host's pointer-events toggles — claim it explicitly.
    const grab = () => this.input.focus({ preventScroll: true })
    this.input.addEventListener('pointerdown', () => requestAnimationFrame(grab))
    this.el.querySelector('.hr-composer')!.addEventListener('pointerdown', (e) => {
      if ((e.target as HTMLElement).tagName !== 'TEXTAREA' && !(e.target as HTMLElement).closest('.hr-btn')) {
        requestAnimationFrame(grab)
      }
    })
    this.el.querySelector('.hr-btn.send')!.addEventListener('click', () => this.submit())
    this.input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        this.submit()
      }
    })
    this.input.addEventListener('input', () => {
      this.input.style.height = 'auto'
      this.input.style.height = Math.min(96, this.input.scrollHeight) + 'px'
      this.el.querySelector('.hr-btn.send')!.classList.toggle('ready', this.input.value.trim().length > 0)
      this.syncMirror()
    })
    this.input.addEventListener('scroll', () => {
      this.mirror.scrollTop = this.input.scrollTop
      this.mirror.scrollLeft = this.input.scrollLeft
    })
    // IME composition is invisible while the textarea's own text is
    // transparent — surface the real glyphs for the duration.
    this.input.addEventListener('compositionstart', () => this.el.querySelector('.hr-field')!.classList.add('hr-composing'))
    this.input.addEventListener('compositionend', () => this.el.querySelector('.hr-field')!.classList.remove('hr-composing'))
    this.targetChip.querySelector('.hr-x')!.addEventListener('click', () => this.setTarget(null))
    this.mic.addEventListener('click', () => this.toggleMic())

    for (const m of logs.get(key) ?? []) {this.renderMsg(m.who, m.text, m.kind)}
    void color
    this.scope.appendChild(this.el)
  }

  /** Names the composer mirror and message bodies tint as @mentions —
   *  room member display names plus 'everyone'. */
  setMentions(names: Iterable<string>) {
    this.mentions.clear()

    for (const n of names) {
      const t = n.trim().toLowerCase()

      if (t) {this.mentions.add(t)}
    }

    this.syncMirror()
  }

  private syncMirror() {
    this.mirror.replaceChildren(renderMirror(this.input.value, this.mentions))
  }

  private submit() {
    const text = this.input.value.trim()

    if (!text) {return}
    this.input.value = ''
    this.input.style.height = 'auto'
    this.syncMirror()
    this.hooks.onSend(text, this.target ?? undefined)

    if (this.target) {this.setTarget(null)}
  }

  /** Grab the composer — click-mascot-and-type should just work.
   *  Retried: pointer-up focus settle and host display flicker can eat
   *  the first attempt. */
  focus() {
    const go = () => this.input.focus({ preventScroll: true })

    requestAnimationFrame(go)
    setTimeout(go, 60)
    setTimeout(go, 180)
  }

  setTarget(t: ElementInfo | null) {
    this.target = t
    this.targetChip.style.display = t ? 'flex' : 'none'

    if (t) {this.targetChip.querySelector('.hr-target-label')!.textContent = t.label}
  }

  setStatus(status: string, line?: string) {
    this.statusEl.textContent = line || status
    const dot = this.el.querySelector<HTMLElement>('.hr-dot')

    if (dot) {
      const c = STATUS_COLOR[status] ?? '#6b7280'
      dot.style.background = c
      dot.style.color = c
    }
  }

  /** Turn presence (OpenMausBot): while a bot works, its face pops in at
   *  the tail with a shimmering "Thinking" and a self-ticking elapsed
   *  readout; when the reply lands the presence shrinks away and the
   *  answer row grows up in its place. Kept out of the persistent log. */
  showTyping(who: string, avatar?: string) {
    if (this.typing.has(who)) {return}
    const div = document.createElement('div')
    div.className = 'hr-presence'
    const face = document.createElement(avatar ? 'img' : 'span')
    face.className = 'hr-presence-face'

    if (avatar) {(face as HTMLImageElement).src = avatar}
    else {face.textContent = who.slice(0, 1).toUpperCase()}

    const label = document.createElement('span')
    label.className = 'hr-think'
    label.textContent = 'Thinking'
    const elapsed = document.createElement('span')
    elapsed.className = 'hr-elapsed'
    const t0 = Date.now()

    const tick = () => {
      elapsed.textContent = fmtElapsed(Date.now() - t0)
    }

    tick()
    this.typingTimers.set(who, window.setInterval(tick, 1000))
    div.append(face, label, elapsed)
    this.logEl.appendChild(div)
    this.logEl.scrollTop = this.logEl.scrollHeight
    this.typing.set(who, div)
  }

  clearTyping(who: string) {
    const div = this.typing.get(who)

    if (!div) {return}
    this.typing.delete(who)
    this.clearedAt.set(who, Date.now())
    const t = this.typingTimers.get(who)

    if (t !== undefined) {
      clearInterval(t)
      this.typingTimers.delete(who)
    }

    div.classList.add('hr-presence-out')
    window.setTimeout(() => div.remove(), 260)
  }

  private typing = new Map<string, HTMLElement>()

  addMsg(who: string, text: string, kind: 'user' | 'bot' | 'sys') {
    const list = logs.get(this.key) ?? []
    list.push({ who, text, kind })

    if (list.length > 200) {list.shift()}
    logs.set(this.key, list)
    this.renderMsg(who, text, kind)
  }

  private renderMsg(who: string, text: string, kind: 'user' | 'bot' | 'sys') {
    const div = document.createElement('div')
    div.className = `hr-msg ${kind}`

    if (kind !== 'sys' && who) {
      const w = document.createElement('div')
      w.className = 'hr-who'
      w.textContent = who
      div.appendChild(w)
    }

    // A bot row landing right after its presence row is the turn's
    // answer — it grows up from where the mascot was.
    const cleared = this.clearedAt.get(who)

    if (kind === 'bot' && cleared !== undefined && Date.now() - cleared < 900) {
      div.classList.add('hr-answer')
      this.clearedAt.delete(who)
    }

    const body = document.createElement('div')
    body.className = 'hr-md'
    body.appendChild(renderBody(text, this.mentions))
    div.appendChild(body)
    this.logEl.appendChild(div)
    this.logEl.scrollTop = this.logEl.scrollHeight
  }

  private toggleMic() {
    const SR = window as unknown as {
      SpeechRecognition?: SpeechRecognitionCtor
      webkitSpeechRecognition?: SpeechRecognitionCtor
    }

    const Ctor = SR.SpeechRecognition ?? SR.webkitSpeechRecognition

    if (!Ctor) {
      this.addMsg('', 'Voice input not supported in this browser', 'sys')

      return
    }

    if (this.recognizing) {
      this.rec?.stop()

      return
    }

    const rec = new Ctor()
    this.rec = rec
    rec.continuous = false
    rec.interimResults = true
    rec.lang = navigator.language

    rec.onstart = () => {
      this.recognizing = true
      this.mic.classList.add('on')
    }

    rec.onend = () => {
      this.recognizing = false
      this.mic.classList.remove('on')
    }

    rec.onresult = (e: SpeechRecognitionEventLike) => {
      let text = ''

      for (let i = 0; i < e.results.length; i++) {text += e.results[i]![0]!.transcript}
      this.input.value = text
      this.syncMirror()
    }

    rec.onerror = (e?: { error?: string }) => {
      this.recognizing = false
      this.mic.classList.remove('on')

      if (e?.error === 'not-allowed' || e?.error === 'service-not-allowed') {
        this.addMsg('', 'Mic permission denied — allow the mic for this page, then try again', 'sys')
      }
    }

    try {
      rec.start()
    } catch {
      this.recognizing = false
      this.mic.classList.remove('on')
    }
  }

  close() {
    this.rec?.abort()

    for (const t of this.typingTimers.values()) {clearInterval(t)}
    this.typingTimers.clear()
    this.el.remove()
    this.hooks.onClose()
  }
}

function roomMsgRow(msg: RoomMsg, botName: (id: string) => string) {
  return {
    who: msg.author === 'user' ? 'You' : msg.author === 'system' ? 'system' : botName(msg.author),
    text: msg.text,
    kind: (msg.author === 'user' ? 'user' : msg.author === 'system' ? 'sys' : 'bot') as 'user' | 'bot' | 'sys',
  }
}

export function roomMsgToPanel(panel: Panel, msg: RoomMsg, botName: (id: string) => string) {
  const row = roomMsgRow(msg, botName)
  panel.addMsg(row.who, row.text, row.kind)
}

/** Buffer a room message into the persistent log while its panel is closed,
 *  so the unread badge isn't a dead end — reopening replays the gap. */
export function bufferRoomMsg(roomId: string, msg: RoomMsg, botName: (id: string) => string) {
  const list = logs.get(roomId) ?? []
  list.push(roomMsgRow(msg, botName))

  if (list.length > 200) {list.shift()}
  logs.set(roomId, list)
}

export function botAvatarUrl(bot: Bot): string {
  return faceDataUrl(bot.name, 48)
}
