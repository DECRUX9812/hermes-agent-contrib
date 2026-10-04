import type { Bot, Room, RoomMsg, SwToContent } from '../shared/types'

import { runPageAction, setWindowManager, uniqueSelector } from './actions'
import { faceDataUrl } from './face'
import { type MascotAction, OverlayScene } from './mascot3d'
import { type ElementInfo, Panel, roomMsgToPanel } from './panel'
import { OVERLAY_CSS } from './styles'
import { WindowManager } from './windows'

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
  private windows: WindowManager
  private siteBot: Bot | null = null

  constructor(send: (msg: unknown) => void) {
    this.send = send
    this.host = document.createElement('div')
    this.host.id = 'hermes-bot-room'
    this.root = this.host.attachShadow({ mode: 'open' })
    // KeyboardEvents are composed:true — they cross the shadow boundary and
    // reach the page (GitHub's "/" palette opened while typing in our composer).
    // The overlay is a separate app surface: swallow keys at the shadow root.
    for (const type of ['keydown', 'keyup', 'keypress']) {
      this.root.addEventListener(type, (e) => e.stopPropagation())
    }
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

    this.windows = new WindowManager(this.root)
    setWindowManager(this.windows)
    this.windows.onFullscreen = (full) => this.setDocked(full)

    this.windows.onCard = (_winId, item) => {
      if (item.url) {
        const embed = item.url.includes('youtube.com/watch')
          ? item.url.replace('youtube.com/watch?v=', 'youtube.com/embed/')
          : item.url

        this.windows.open({ title: item.title, kind: 'embed', url: embed, size: 'lg' })
      }
    }

    this.windows.onSearch = (_winId, query) => {
      const bot = this.siteBot ?? [...this.bots.values()][0]

      if (bot) {
        this.send({ type: 'task', botId: bot.id, text: `Search request: ${query}` })
      }
    }

    document.documentElement.appendChild(this.host)
  }

  /** Fullscreen window open → mascots dock to the right edge as chips. */
  private setDocked(dock: boolean) {
    let i = 0

    for (const [id, p] of this.pos) {
      const m = this.scene.get(id)

      if (!m) {
        continue
      }

      if (dock) {
        m.group.userData.undockX = p.x
        m.group.userData.undockY = p.y
        const x = innerWidth - 40
        const y = 90 + i * 72

        p.x = x
        p.y = y
        m.moveTo(x, y)
        m.group.scale.setScalar(0.5)
        const hit = this.hits.get(id)

        if (hit) {
          hit.style.left = x + 'px'
          hit.style.top = y + 'px'
          hit.style.transform = 'translate(-50%,-50%) scale(.55)'
        }
      } else {
        const ux = (m.group.userData.undockX as number) ?? p.x
        const uy = (m.group.userData.undockY as number) ?? p.y

        p.x = ux
        p.y = uy
        m.moveTo(ux, uy)
        m.group.scale.setScalar(1)
        const hit = this.hits.get(id)

        if (hit) {
          hit.style.left = ux + 'px'
          hit.style.top = uy + 'px'
          hit.style.transform = ''
        }
      }

      i++
    }
  }

  handle(msg: SwToContent) {
    switch (msg.type) {
      case 'init':
        this.setHidden(!msg.enabled)
        this.siteBot = msg.siteBot ?? null
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
    // the site avatar rides this tab's URL — it survives roster refreshes
    const all = this.siteBot ? [...bots, this.siteBot] : bots
    const seen = new Set<string>()
    let idx = 0

    for (const b of all) {
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
    m.setWorking(b.status === 'working')

    if (b.status === 'working') {m.play('talk', 1)}
    else if (b.status === 'sleeping') {m.play('sleep', Infinity)}
    else if (b.status === 'idle') {m.play('idle', Infinity)}

    const panel = this.panels.get(`solo:${b.id}`)
    panel?.setStatus(b.status, b.statusLine)
  }

  private onRoomMsg(msg: RoomMsg) {
    const panel = this.panels.get(msg.roomId)
    const name = (id: string) => this.bots.get(id)?.displayName ?? id.split(':').pop() ?? id

    if (panel) {
      if (msg.ephemeral) {
        panel.showTyping(name(msg.author))
      } else {
        panel.clearTyping(name(msg.author))
        roomMsgToPanel(panel, msg, name)
      }
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

    const r = (result ?? {}) as Record<string, unknown>
    // runPageAction returns {ok, ...payload} (url/title/elements/…) — forward
    // the payload, not a 'result' field that doesn't exist, or agents always
    // see "0 bytes of page structure".
    let payload: unknown

    if ('result' in r) {
      payload = r.result
    } else {
      const { ok: _ok, error: _err, ...rest } = r
      payload = Object.keys(rest).length > 0 ? rest : undefined
    }

    this.send({
      type: 'action.result',
      payload: {
        commandId,
        ok: r.ok !== false,
        result: payload,
        error: r.error as string | undefined,
      },
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

    hit.addEventListener('pointerenter', () => this.scene.get(b.id)?.setHover(true))
    hit.addEventListener('pointerleave', () => this.scene.get(b.id)?.setHover(false))
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
    // The dragged .hr-hit sits under the cursor — elementFromPoint returns
    // our own host (shadow retargeting), so walk the full hit stack and take
    // the first element that isn't ours.
    const el = document
      .elementsFromPoint(x, y)
      .find(e => e !== this.host && e !== document.documentElement && e !== document.body)

    this.clearOutline()

    if (el) {
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

        // room sends come back through the room.msg broadcast — echoing them
        // here too would render the user's bubble twice.
        if (!room) {panel.addMsg('You', text, 'user')}
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
    panel.focus()

    return panel
  }

  private createRoom() {
    const name = window.prompt('Room name')

    if (!name) {return}
    this.send({ type: 'room.create', name })
  }

  private setRooms(rooms: Room[]) {
    this.rooms = new Map(rooms.map((r) => [r.id, r]))

    // close panels whose room was removed — they can never receive again
    for (const key of [...this.panels.keys()]) {
      if (!key.startsWith('solo:') && !this.rooms.has(key)) {
        this.panels.get(key)?.close()
      }
    }

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
