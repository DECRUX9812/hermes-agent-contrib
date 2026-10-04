import type { Bot, RoomMsg } from '../shared/types'

import { faceDataUrl } from './face'

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

export class Panel {
  el: HTMLElement
  private logEl: HTMLElement
  private input: HTMLTextAreaElement
  private target: ElementInfo | null = null
  private targetChip: HTMLElement
  private mic: HTMLElement
  private statusEl: HTMLElement
  private recognizing = false
  private rec: SpeechRecognitionLike | null = null

  constructor(
    private scope: ShadowRoot | HTMLElement,
    private key: string,
    title: string,
    color: string,
    status: string,
    private hooks: PanelHooks,
  ) {
    this.el = document.createElement('div')
    this.el.className = 'hr-panel'
    this.el.innerHTML = `
      <div class="hr-panel-head">
        <span class="hr-dot" style="background:${STATUS_COLOR[status] ?? '#6b7280'}"></span>
        <span class="hr-title"></span>
        <span class="hr-status"></span>
        <button class="hr-panel-x" title="Close">✕</button>
      </div>
      <div class="hr-panel-log"></div>
      <div class="hr-target-chip" style="display:none">
        <span>◎</span><span class="hr-target-label"></span><span class="hr-x">✕</span>
      </div>
      <div class="hr-composer">
        <textarea rows="1" placeholder="Give ${title} a task…"></textarea>
        <button class="hr-btn mic" title="Speak">🎙</button>
        <button class="hr-btn send" title="Send">➤</button>
      </div>`
    this.el.querySelector('.hr-title')!.textContent = title
    this.statusEl = this.el.querySelector('.hr-status')!
    this.statusEl.textContent = status
    this.logEl = this.el.querySelector('.hr-panel-log')!
    this.input = this.el.querySelector('textarea')!
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
      this.input.style.height = Math.min(90, this.input.scrollHeight) + 'px'
    })
    this.targetChip.querySelector('.hr-x')!.addEventListener('click', () => this.setTarget(null))
    this.mic.addEventListener('click', () => this.toggleMic())

    for (const m of logs.get(key) ?? []) {this.renderMsg(m.who, m.text, m.kind)}
    void color
    this.scope.appendChild(this.el)
  }

  private submit() {
    const text = this.input.value.trim()

    if (!text) {return}
    this.input.value = ''
    this.input.style.height = 'auto'
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

    if (dot) {dot.style.background = STATUS_COLOR[status] ?? '#6b7280'}
  }

  /** Transient "typing" bubble for an ephemeral relay marker — kept out of
   *  the persistent log and replaced by the real reply when it lands. */
  showTyping(who: string) {
    if (this.typing.has(who)) {return}
    const div = document.createElement('div')
    div.className = 'hr-msg bot typing'
    const w = document.createElement('div')
    w.className = 'hr-who'
    w.textContent = who
    const body = document.createElement('div')
    body.className = 'hr-dots'
    body.textContent = '…'
    div.append(w, body)
    this.logEl.appendChild(div)
    this.logEl.scrollTop = this.logEl.scrollHeight
    this.typing.set(who, div)
  }

  clearTyping(who: string) {
    this.typing.get(who)?.remove()
    this.typing.delete(who)
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

    const body = document.createElement('div')
    body.textContent = text
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
    this.el.remove()
    this.hooks.onClose()
  }
}

export function roomMsgToPanel(panel: Panel, msg: RoomMsg, botName: (id: string) => string) {
  const who = msg.author === 'user' ? 'You' : msg.author === 'system' ? 'system' : botName(msg.author)
  panel.addMsg(who, msg.text, msg.author === 'user' ? 'user' : msg.author === 'system' ? 'sys' : 'bot')
}

export function botAvatarUrl(bot: Bot): string {
  return faceDataUrl(bot.name, 48)
}
