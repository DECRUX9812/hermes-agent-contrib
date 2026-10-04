import type { Bot, Room, RoomMsg, SwToContent } from '../shared/types'

import { runPageAction, uniqueSelector } from './actions'
import { faceDataUrl } from './face'
import { type MascotAction, OverlayScene } from './mascot3d'
import { type ElementInfo, Panel, roomMsgToPanel } from './panel'
import { OVERLAY_CSS } from './styles'

const GRID_GAP = 110

export class Stage {
  private host: HTMLElement
  private root: ShadowRoot
  private scene: OverlayScene
  private bots = new Map<string, Bot>()
  private rooms = new Map<string, Room>()
  private hits = new Map<string, HTMLElement>()
  private panels = new Map<string, Panel>()
  private pos = new Map<string, { x: number; y: number }>()
  private send: (msg: unknown) => void
  private dropzone: HTMLElement
  private outline: HTMLElement | null = null
  private ghost: HTMLElement
  private roomBar: HTMLElement
  private dropTarget: ElementInfo | null = null
  private hidden = false

  constructor(send: (msg: unknown) => void) {
    this.send = send
    this.host = document.createElement('div')
    this.host.id = 'hermes-bot-room'
    this.root = this.host.attachShadow({ mode: 'open' })
    const style = document.createElement('style')
    style.textContent = OVERLAY_CSS
    this.root.appendChild(style)

    const canvas = document.createElement('canvas')
    canvas.className = 'hr-canvas'
    this.root.appendChild(canvas)
    this.scene = new OverlayScene(canvas)

    this.roomBar = document.createElement('div')
    this.roomBar.className = 'hr-roombar'
    this.root.appendChild(this.roomBar)

    const addBtn = document.createElement('button')
    addBtn.className = 'hr-addroom'
    addBtn.textContent = '+'
    addBtn.title = 'New room'
    addBtn.addEventListener('click', () => this.createRoom())
    this.root.appendChild(addBtn)

    this.dropzone = document.createElement('div')
    this.dropzone.className = 'hr-dropzone'
    this.dropzone.innerHTML = '<div class="hr-dz-label">Drop on an element or a room</div>'
    this.root.appendChild(this.dropzone)

    this.ghost = document.createElement('div')
    this.ghost.className = 'hr-ghost'
    this.ghost.style.display = 'none'
    this.root.appendChild(this.ghost)

    document.documentElement.appendChild(this.host)
  }

  handle(msg: SwToContent) {
    switch (msg.type) {
      case 'init':
        this.setHidden(!msg.enabled)
        this.setBots(msg.bots)
        this.setRooms(msg.rooms)

        break

      case 'bots':
        this.setBots(msg.bots)

        break

      case 'bot.status':
        this.botStatus(msg.bot)

        break

      case 'rooms':
        this.setRooms(msg.rooms)

        break

      case 'room.msg':
        this.onRoomMsg(msg.msg)

        break

      case 'action':
        void this.onAction(msg.request.commandId, msg.request.action, msg.request.arguments)

        break

      case 'overlay.hidden':
        this.setHidden(msg.hidden)

        break
    }
  }

  private setHidden(v: boolean) {
    this.hidden = v
    this.host.style.display = v ? 'none' : ''
  }

  private setBots(bots: Bot[]) {
    const seen = new Set<string>()
    let idx = 0

    for (const b of bots) {
      seen.add(b.id)
      const prev = this.bots.get(b.id)
      this.bots.set(b.id, b)

      if (!this.scene.has(b.id)) {
        const p = this.pos.get(b.id) ?? this.spawnPos(idx)
        this.pos.set(b.id, p)
        this.scene.add(b.id, b.name, p.x, p.y)
        this.makeHit(b)
      }

      if (prev?.status !== b.status) {this.botStatus(b)}
      idx++
    }

    for (const id of [...this.bots.keys()]) {
      if (!seen.has(id)) {
        this.bots.delete(id)
        this.scene.remove(id)
        this.hits.get(id)?.remove()
        this.hits.delete(id)
        this.pos.delete(id)
      }
    }

    this.renderRooms()
  }

  private spawnPos(i: number): { x: number; y: number } {
    const cols = Math.max(1, Math.floor((innerWidth - 160) / GRID_GAP))
    const col = i % cols
    const row = Math.floor(i / cols)

    return { x: innerWidth - 90 - col * GRID_GAP, y: 110 + row * GRID_GAP }
  }

  private botStatus(b: Bot) {
    const m = this.scene.get(b.id)

    if (!m) {return}
    const hit = this.hits.get(b.id)
    hit?.classList.toggle('working', b.status === 'working')

    if (b.status === 'working') {m.play('talk', 1)}
    else if (b.status === 'sleeping') {m.play('sleep', Infinity)}
    else if (b.status === 'idle') {m.play('idle', Infinity)}

    const panel = this.panels.get(`solo:${b.id}`)
    panel?.setStatus(b.status, b.statusLine)
  }

  private onRoomMsg(msg: RoomMsg) {
    const panel = this.panels.get(msg.roomId)

    if (panel) {
      roomMsgToPanel(panel, msg, (id) => this.bots.get(id)?.displayName ?? id.split(':').pop() ?? id)
    }

    if (msg.ephemeral) {return}

    if (msg.author !== 'user' && msg.author !== 'system') {
      const m = this.scene.get(msg.author)
      m?.setTalking(true)
      setTimeout(() => m?.setTalking(false), Math.min(3000, msg.text.length * 20))
    }
  }

  private async onAction(commandId: string, action: string, args: Record<string, unknown>) {
    let result: unknown

    if (action === 'mascot.perform') {
      const botId = (args.botId as string) ?? [...this.bots.keys()][0]
      const m = botId ? this.scene.get(botId) : undefined

      if (m) {
        const act = (args.action as MascotAction) ?? 'dance'

        if (act === 'point' && typeof args.x === 'number') {m.pointAt(args.x, (args.y as number) ?? 0)}
        else {m.play(act, (args.ms as number) ? (args.ms as number) / 1000 : 1.4)}

        result = { ok: true }
      } else {result = { ok: false, error: 'bot not on stage' }}
    } else {
      result = await runPageAction(action, args).catch((e) => ({ ok: false, error: String(e) }))
    }

    const r = result as { ok?: boolean; result?: unknown; error?: string }
    this.send({
      type: 'action.result',
      payload: { commandId, ok: r?.ok !== false, result: r?.result, error: r?.error },
    })
  }

  private makeHit(b: Bot) {
    const hit = document.createElement('div')
    hit.className = 'hr-hit'
    hit.dataset.botId = b.id
    hit.innerHTML = `<span class="hr-name"></span><span class="hr-badge">●</span>`
    hit.querySelector('.hr-name')!.textContent = b.name
    const p = this.pos.get(b.id)!
    hit.style.left = p.x + 'px'
    hit.style.top = p.y + 'px'
    this.root.appendChild(hit)
    this.hits.set(b.id, hit)

    let dragging = false
    let moved = false
    let sx = 0
    let sy = 0

    hit.addEventListener('pointerdown', (e) => {
      dragging = true
      moved = false
      sx = e.clientX
      sy = e.clientY
      hit.setPointerCapture(e.pointerId)
      hit.classList.add('dragging')
      this.dropzone.classList.add('on')
      e.preventDefault()
    })
    hit.addEventListener('pointermove', (e) => {
      if (!dragging) {return}
      const dx = e.clientX - sx
      const dy = e.clientY - sy

      if (Math.abs(dx) + Math.abs(dy) > 5) {moved = true}
      const x = e.clientX
      const y = e.clientY
      this.pos.set(b.id, { x, y })
      this.scene.get(b.id)?.moveTo(x, y)
      hit.style.left = x + 'px'
      hit.style.top = y + 'px'
      this.updateDropTarget(e.clientX, e.clientY)
    })

    const drop = (e: PointerEvent) => {
      if (!dragging) {return}
      dragging = false
      hit.classList.remove('dragging')
      this.dropzone.classList.remove('on')
      this.clearOutline()
      this.ghost.style.display = 'none'
      const roomId = this.roomAt(e.clientX, e.clientY)

      if (roomId) {
        this.send({ type: 'room.move', roomId, botId: b.id })
        this.scene.get(b.id)?.play('jump')
      } else if (this.dropTarget && moved) {
        const panel = this.openPanel(`solo:${b.id}`, b)
        panel.setTarget(this.dropTarget)
        this.dropTarget = null
      } else if (!moved) {
        this.togglePanel(b)
      }

      this.send({
        type: 'mascot.move',
        botId: b.id,
        x: this.pos.get(b.id)!.x,
        y: this.pos.get(b.id)!.y,
      })
      void e
    }

    hit.addEventListener('pointerup', drop)
    hit.addEventListener('pointercancel', drop)
  }

  private updateDropTarget(x: number, y: number) {
    // elementFromPoint sees the host element; temporarily hide it to peek under.
    this.host.style.display = 'none'
    const el = document.elementFromPoint(x, y)
    this.host.style.display = ''
    this.clearOutline()

    if (el && el !== document.documentElement && el !== document.body) {
      const r = el.getBoundingClientRect()
      const o = document.createElement('div')
      o.className = 'hr-eloutline'
      o.style.cssText = `left:${r.x - 3}px;top:${r.y - 3}px;width:${r.width + 6}px;height:${r.height + 6}px`
      this.root.appendChild(o)
      this.outline = o
      const label = (el.getAttribute('aria-label') ?? el.textContent ?? el.localName).replace(/\s+/g, ' ').trim().slice(0, 40)
      this.dropTarget = { selector: uniqueSelector(el), label: `${el.localName} "${label}"` }
      this.ghost.textContent = `◎ ${this.dropTarget.label}`
      this.ghost.style.left = x + 'px'
      this.ghost.style.top = y + 'px'
      this.ghost.style.display = 'block'
    } else {
      this.dropTarget = null
    }
  }

  private clearOutline() {
    this.outline?.remove()
    this.outline = null
  }

  private roomAt(x: number, y: number): string | null {
    for (const el of this.root.querySelectorAll<HTMLElement>('.hr-room')) {
      const r = el.getBoundingClientRect()

      if (x >= r.x && x <= r.x + r.width && y >= r.y && y <= r.y + r.height) {return el.dataset.roomId ?? null}
    }

    return null
  }

  private togglePanel(b: Bot) {
    const key = `solo:${b.id}`

    if (this.panels.has(key)) {
      this.panels.get(key)!.close()

      return
    }

    this.openPanel(key, b)
    this.scene.get(b.id)?.play('wave', 1.2)
  }

  private openPanel(key: string, b?: Bot, room?: Room): Panel {
    const existing = this.panels.get(key)

    if (existing) {return existing}
    const title = room ? room.name : b?.name ?? 'Bot'
    const color = b?.color ?? '#5470ff'
    const status = b?.status ?? 'idle'

    const panel = new Panel(this.root, key, title, color, status, {
      onSend: (text, target) => {
        const payload = {
          type: 'task',
          text: target ? `${text}\n\n[Target element: ${target.selector} — ${target.label}]` : text,
          roomId: room ? key : undefined,
          botId: room ? undefined : b?.id,
          targetSelector: target?.selector,
        }

        this.send(payload)
        panel.addMsg('You', text, 'user')
      },
      onClose: () => this.panels.delete(key),
    })

    this.panels.set(key, panel)
    // position near the mascot
    const botId = room ? room.memberBotIds[0] : b?.id
    const p = botId ? this.pos.get(botId) : undefined
    const px = Math.min(Math.max((p?.x ?? innerWidth - 200) - 150, 10), innerWidth - 320)
    const py = Math.min(Math.max((p?.y ?? 200) + 60, 10), innerHeight - 380)
    panel.el.style.left = px + 'px'
    panel.el.style.top = py + 'px'

    return panel
  }

  private createRoom() {
    const name = window.prompt('Room name')

    if (!name) {return}
    this.send({ type: 'room.create', name })
  }

  private setRooms(rooms: Room[]) {
    this.rooms = new Map(rooms.map((r) => [r.id, r]))
    this.renderRooms()
    this.layoutRoomMembers()
  }

  private layoutRoomMembers() {
    for (const room of this.rooms.values()) {
      if (!room.anchor) {continue}
      room.memberBotIds.forEach((botId, i) => {
        const angle = (i / Math.max(1, room.memberBotIds.length)) * Math.PI * 2
        const x = room.anchor!.x + Math.cos(angle) * 70
        const y = room.anchor!.y + Math.sin(angle) * 55
        this.pos.set(botId, { x, y })
        this.scene.get(botId)?.moveTo(x, y)
        const hit = this.hits.get(botId)

        if (hit) {
          hit.style.left = x + 'px'
          hit.style.top = y + 'px'
        }
      })
    }
  }

  private renderRooms() {
    this.roomBar.innerHTML = ''

    for (const room of this.rooms.values()) {
      const chip = document.createElement('div')
      chip.className = 'hr-room'
      chip.dataset.roomId = room.id

      const faces = room.memberBotIds
        .map((id) => {
          const b = this.bots.get(id)

          return b ? `<span class="hr-face"><img src="${faceDataUrl(b.name, 40)}" width="20" height="20" style="border-radius:50%"/></span>` : ''
        })
        .join('')

      chip.innerHTML = `<span class="hr-faces">${faces}</span><span></span>`
      chip.querySelector('span:last-child')!.textContent = room.name
      chip.title = `${room.name} — ${room.memberBotIds.length} bot(s)${room.scratchpad ? ' · notes: ' + room.scratchpad : ''}`
      chip.addEventListener('click', () => {
        this.openPanel(room.id, undefined, room)
      })
      chip.addEventListener('contextmenu', (e) => {
        e.preventDefault()

        if (window.confirm(`Remove room "${room.name}"?`)) {this.send({ type: 'room.remove', roomId: room.id })}
      })
      this.roomBar.appendChild(chip)
      // anchor: chip position in page coords, computed after mount
      requestAnimationFrame(() => {
        const r = chip.getBoundingClientRect()

        if (!room.anchor || Math.abs(room.anchor.x - (r.x + r.width / 2)) > 200) {
          room.anchor = { x: r.x + r.width / 2, y: r.y - 110 }
        }
      })
    }

    this.layoutRoomMembers()
  }
}

export function bootstrap(): void {
  const pending: SwToContent[] = []
  let stage: Stage | null = null
  const send = (msg: unknown) => chrome.runtime.sendMessage(msg)
  chrome.runtime.onMessage.addListener((msg: SwToContent) => {
    if (!stage) {pending.push(msg)}
    else {stage.handle(msg)}
  })
  chrome.runtime.sendMessage({ type: 'hello', url: location.href, title: document.title }, (resp: SwToContent | undefined) => {
    if (!resp || resp.type !== 'init') {return}
    stage = new Stage(send)
    stage.handle(resp)

    for (const m of pending.splice(0)) {stage.handle(m)}
  })
}
