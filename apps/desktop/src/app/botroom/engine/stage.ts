import { faceDataUrl } from './face'
import { type MascotAction, OverlayScene } from './mascot3d'
import { type PaletteSection, showContextMenu, showPalette } from './menu'
import { type ElementInfo, Panel, roomMsgToPanel } from './panel'
import { OVERLAY_CSS } from './styles'
import type { Bot, Bot as BotType, ContentToSw, Room, RoomMsg, SwToContent } from './types'
import { WindowManager } from './windows'

const GRID_GAP = 110

/** Selectors whose pixels take the pointer — everything else clicks through
 *  to the desktop below. Mirrors the pet overlay's sprite-alpha hit test. */
const INTERACTIVE =
  '.hr-hit, .hr-panel, .hr-window, .hr-menu, .hr-palette, .hr-tray, .hr-launcher, .hr-deck, .hr-ghost, button'

/**
 * The Bot Room stage: full-desktop overlay hosting mascot characters, chat
 * panels, rooms tray, edge deck, command palette. Desktop adaptation of the
 * browser-extension stage — `send` is the IPC control channel to the main
 * renderer instead of a service worker, and page-element drop targeting is
 * replaced by room drops + focusable/click-through window management.
 */
export class Stage {
  private root: ShadowRoot
  private scene: OverlayScene
  private bots = new Map<string, BotType>()
  private rooms = new Map<string, Room>()
  private hits = new Map<string, HTMLElement>()
  private panels = new Map<string, Panel>()
  private pos = new Map<string, { x: number; y: number }>()
  private send: (msg: ContentToSw) => void
  private dropzone: HTMLElement
  private ghost: HTMLElement
  private roomBar: HTMLElement
  private deck: HTMLElement
  private windows: WindowManager
  private sleeping = new Set<string>()
  private interactive = false
  private focusable = false
  /** Live mascot drags — latches the window interactive so the pointer can
   *  outrun the sprite without the OS swallowing the gesture's own events. */
  private activeDrags = 0

  constructor(host: HTMLElement, send: (msg: ContentToSw) => void) {
    this.send = send
    this.root = host.attachShadow({ mode: 'open' })

    const style = document.createElement('style')
    style.textContent = OVERLAY_CSS
    this.root.appendChild(style)

    const canvas = document.createElement('canvas')
    canvas.className = 'hr-canvas'
    this.root.appendChild(canvas)
    this.scene = new OverlayScene(canvas)

    // Edge deck — the left rail listing every bot (Agent-Deck style):
    // avatar + live status dot; click opens that bot's panel.
    this.deck = document.createElement('div')
    this.deck.className = 'hr-deck'
    this.root.appendChild(this.deck)

    // rooms + new-room inside one floating pill tray
    const tray = document.createElement('div')
    tray.className = 'hr-tray'
    this.roomBar = document.createElement('div')
    this.roomBar.className = 'hr-roombar'
    tray.appendChild(this.roomBar)

    const addBtn = document.createElement('button')
    addBtn.className = 'hr-addroom'
    addBtn.textContent = '+'
    addBtn.title = 'New room'
    addBtn.addEventListener('click', () => this.createRoom())
    tray.appendChild(addBtn)
    this.root.appendChild(tray)

    const launcher = document.createElement('button')
    launcher.className = 'hr-launcher'
    launcher.title = 'Bot Room — commands'
    launcher.innerHTML =
      '<svg viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="1.6" opacity=".55"/><circle cx="8.8" cy="11" r="1.5" fill="currentColor"/><circle cx="15.2" cy="11" r="1.5" fill="currentColor"/><path d="M9 15.4c.8.8 5.2.8 6 0" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>'
    launcher.addEventListener('click', () => this.openPalette())
    this.root.appendChild(launcher)

    this.dropzone = document.createElement('div')
    this.dropzone.className = 'hr-dropzone'
    this.dropzone.innerHTML = '<div class="hr-dz-label">Drop on <b>a room</b> to move in</div>'
    this.root.appendChild(this.dropzone)

    this.ghost = document.createElement('div')
    this.ghost.className = 'hr-ghost'
    this.ghost.style.display = 'none'
    this.root.appendChild(this.ghost)

    this.windows = new WindowManager(this.root)
    this.windows.onFullscreen = (full) => this.setDocked(full)

    this.windows.onCard = (_id, item) => {
      if (item.url) {
        const embed = item.url.includes('youtube.com/watch')
          ? item.url.replace('youtube.com/watch?v=', 'youtube.com/embed/')
          : item.url

        this.windows.open({ title: item.title, kind: 'embed', url: embed, size: 'lg' })
      }
    }

    // Click-through: while the OS ignores us, forwarded mousemoves still
    // arrive — hit-test them so interactive pixels re-arm the pointer.
    // Electron forwards raw *mouse* events, not PointerEvents, so listen
    // for both: 'mousemove' is the only probe that fires while ignored.
    const probe = (e: { clientX: number; clientY: number }) =>
      this.updateInteractivity(e.clientX, e.clientY)

    document.addEventListener('mousemove', probe, { passive: true })
    document.addEventListener('pointermove', probe, { passive: true })

    // Text fields need the keyboard: flip the window focusable while any
    // input inside the overlay holds focus, non-activating when none does.
    this.root.addEventListener('focusin', () => this.setFocusable(true))
    this.root.addEventListener('focusout', () => {
      requestAnimationFrame(() => {
        if (!this.root.activeElement) {this.setFocusable(false)}
      })
    })
  }

  /** Whether the cursor currently sits on overlay-owned pixels.
   *  While a mascot drag is live the pointer is latched interactive — the
   *  cursor can outrun the sprite, and dropping ignore-mouse mid-gesture
   *  starves the drag of its own move/up events.
   *
   *  `document.elementFromPoint` does NOT pierce shadow boundaries — it
   *  returns the host div for every point inside our stage, which would
   *  leave the window ignoring the mouse forever. Hit-test inside the
   *  shadow root instead; it only exists on our own surface. */
  private updateInteractivity(x: number, y: number) {
    const el =
      this.root.elementFromPoint?.(x, y) ?? document.elementFromPoint(x, y)

    const over =
      this.activeDrags > 0 || Boolean(el && this.hostContains(el) && el.closest(INTERACTIVE))

    if (over !== this.interactive) {
      this.interactive = over
      window.hermesDesktop.botroom.setIgnoreMouse(!over)
    }
  }

  private hostContains(el: Element): boolean {
    // elementFromPoint returns shadow-internal nodes for open shadows; fall
    // back to checking the composed root.
    const root = el.getRootNode()

    return root === this.root || this.root.host.contains(el)
  }

  private setFocusable(v: boolean) {
    if (v === this.focusable) {return}
    this.focusable = v
    window.hermesDesktop.botroom.setFocusable(v)
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
        this.setBots(msg.bots ?? [])
        this.setRooms(msg.rooms ?? [])

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
      case 'bot.action': {
        // Commanded performance on the overlay's copy of the mascot — the
        // per-bot windows get the same push over their own channel, so a
        // 'mascot.action' control animates whichever surface the bot is on.
        const m = msg.botId ? this.scene.get(msg.botId) : undefined
        const action = msg.action

        if (m && action === 'point') {
          m.pointAt(m.group.position.x + 60, m.group.position.y - 40)
        } else if (m && action) {
          m.play(action as MascotAction, 1.4)
        }

        break
      }
    }
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
        this.scene.add(b.id, b.displayName ?? b.name, p.x, p.y)
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

    this.renderDeck()
    this.renderRooms()
  }

  private spawnPos(i: number): { x: number; y: number } {
    const cols = Math.max(1, Math.floor((innerWidth - 240) / GRID_GAP))
    const col = i % cols
    const row = Math.floor(i / cols)

    return { x: innerWidth - 130 - col * GRID_GAP, y: 110 + row * GRID_GAP }
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
    this.renderDeck()
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

  private makeHit(b: Bot) {
    const hit = document.createElement('div')
    hit.className = 'hr-hit'
    hit.dataset.botId = b.id
    hit.innerHTML = `<span class="hr-name"></span><span class="hr-badge">●</span>`
    hit.querySelector('.hr-name')!.textContent = b.displayName ?? b.name
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
    hit.addEventListener('contextmenu', (e) => {
      e.preventDefault()
      this.openBotMenu(b, e.clientX, e.clientY)
    })
    hit.addEventListener('pointerdown', (e) => {
      dragging = true
      moved = false
      sx = e.clientX
      sy = e.clientY
      hit.setPointerCapture(e.pointerId)
      hit.classList.add('dragging')
      this.activeDrags += 1
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
    })

    const drop = (e: PointerEvent) => {
      if (!dragging) {return}
      dragging = false
      this.activeDrags -= 1
      hit.classList.remove('dragging')
      this.dropzone.classList.remove('on')
      this.ghost.style.display = 'none'
      this.updateInteractivity(e.clientX, e.clientY)
      const roomId = this.roomAt(e.clientX, e.clientY)

      if (roomId) {
        this.send({ type: 'room.move', roomId, botId: b.id })
        this.scene.get(b.id)?.play('jump')
      } else if (!moved && e.button === 0) {
        this.togglePanel(b)
      }

      this.send({
        type: 'mascot.move',
        botId: b.id,
        x: this.pos.get(b.id)!.x,
        y: this.pos.get(b.id)!.y,
      })
    }

    hit.addEventListener('pointerup', drop)
    hit.addEventListener('pointercancel', drop)
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
    const title = room ? room.name : b?.displayName ?? b?.name ?? 'Bot'
    const color = b?.color ?? '#5470ff'
    const status = b?.status ?? 'idle'

    const panel = new Panel(this.root, key, title, color, status, {
      onSend: (text, target?: ElementInfo) => {
        this.send({
          type: 'task',
          text: target ? `${text}\n\n[Target: ${target.label}]` : text,
          roomId: room ? key : undefined,
          botId: room ? undefined : b?.id,
        })

        if (!room) {panel.addMsg('You', text, 'user')}
      },
      onClose: () => this.panels.delete(key),
    }, b ? faceDataUrl(b.displayName ?? b.name, 48) : undefined)

    this.panels.set(key, panel)
    const botId = room ? room.memberBotIds[0] : b?.id
    const p = botId ? this.pos.get(botId) : undefined
    const cascade = (this.panels.size - 1) * 26
    const px = Math.min(Math.max((p?.x ?? innerWidth - 200) - 150 + cascade, 10), innerWidth - 330)
    const py = Math.min(Math.max((p?.y ?? 200) + 60 + cascade, 10), innerHeight - 380)
    panel.el.style.left = px + 'px'
    panel.el.style.top = py + 'px'
    panel.focus()

    return panel
  }

  private createRoom() {
    // window.prompt is a no-op under Electron — the room-name prompt is an
    // in-overlay input pinned above the tray instead.
    if (this.root.querySelector('.hr-ask')) {return}

    const ask = document.createElement('div')
    ask.className = 'hr-ask'
    const input = document.createElement('input')
    input.className = 'hr-ask-in'
    input.placeholder = 'Room name…'
    input.maxLength = 40
    ask.appendChild(input)
    this.root.appendChild(ask)
    input.focus()

    let doneCalled = false

    const done = (name?: string) => {
      // Enter then blur (and vice versa) both land here — run once.
      if (doneCalled) {return}
      doneCalled = true
      ask.remove()

      if (name) {this.send({ type: 'room.create', name })}
    }

    input.addEventListener('keydown', (e) => {
      e.stopPropagation()

      if (e.key === 'Enter') {done(input.value.trim() || undefined)}
      else if (e.key === 'Escape') {done()}
    })
    input.addEventListener('blur', () => done())
  }

  private setRooms(rooms: Room[]) {
    this.rooms = new Map(rooms.map((r) => [r.id, r]))

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

          return b ? `<span class="hr-face"><img src="${faceDataUrl(b.displayName ?? b.name, 40)}" width="20" height="20" style="border-radius:50%"/></span>` : ''
        })
        .join('')

      chip.innerHTML = `<span class="hr-faces">${faces}</span><span></span>`
      chip.querySelector('span:last-child')!.textContent = room.name
      chip.title = room.name
      chip.addEventListener('click', () => {
        this.openPanel(room.id, undefined, room)
      })
      chip.addEventListener('contextmenu', (e) => {
        e.preventDefault()
        // window.confirm is also a no-op under Electron — the destructive
        // choice goes through the same context menu surface as mascots.
        showContextMenu(this.root, e.clientX, e.clientY, [
          { icon: '▣', label: `Open "${room.name}"`, run: () => this.openPanel(room.id, undefined, room) },
          { icon: '✕', label: `Remove "${room.name}"`, danger: true, run: () => this.send({ type: 'room.remove', roomId: room.id }) },
        ])
      })
      this.roomBar.appendChild(chip)
      requestAnimationFrame(() => {
        const r = chip.getBoundingClientRect()

        if (!room.anchor || Math.abs(room.anchor.x - (r.x + r.width / 2)) > 200) {
          room.anchor = { x: r.x + r.width / 2, y: r.y - 110 }
        }
      })
    }

    this.layoutRoomMembers()
  }

  /** The left-edge deck: every bot as an avatar chip with live status. */
  private renderDeck() {
    this.deck.innerHTML = ''

    for (const b of this.bots.values()) {
      const chip = document.createElement('button')
      chip.className = 'hr-deck-chip'
      chip.title = `${b.displayName ?? b.name} — ${b.status}`
      chip.innerHTML =
        `<img src="${faceDataUrl(b.displayName ?? b.name, 44)}" width="34" height="34" style="border-radius:50%"/><i class="hr-deck-dot" style="background:${statusColor(b.status)};color:${statusColor(b.status)}"></i>`
      chip.addEventListener('click', () => this.togglePanel(b))
      this.deck.appendChild(chip)
    }
  }

  /** Right-click on a mascot: quick actions without opening a panel. */
  private openBotMenu(b: Bot, x: number, y: number) {
    const m = () => this.scene.get(b.id)
    const asleep = this.sleeping.has(b.id)

    showContextMenu(this.root, x, y, [
      { icon: '◉', label: `Give ${b.displayName ?? b.name} a task`, run: () => this.togglePanel(b) },
      { separator: true, label: '' },
      { icon: '♪', label: 'Dance', run: () => m()?.play('dance', 2.2) },
      { icon: '↺', label: 'Spin', run: () => m()?.play('spin', 1.1) },
      { icon: '↥', label: 'Jump', run: () => m()?.play('jump', 0.8) },
      { icon: '✦', label: 'Celebrate', run: () => m()?.play('celebrate', 1.4) },
      { icon: '◐', label: asleep ? 'Wake' : 'Sleep', run: () => {
        if (this.sleeping.delete(b.id)) {m()?.play('idle', Infinity)}
        else {this.sleeping.add(b.id); m()?.play('sleep', Infinity)}
      } },
      { separator: true, label: '' },
      { icon: '▣', label: 'Open Hermes', run: () => this.send({ type: 'open-app' }) },
      { icon: '◌', label: 'Close overlay', run: () => this.send({ type: 'close' }) },
    ])
  }

  /** Raycast-style command palette from the launcher. */
  private openPalette() {
    const botItems = [...this.bots.values()].map((b) => ({
      icon: '◉',
      label: `Give ${b.displayName ?? b.name} a task`,
      hint: b.status,
      run: () => {
        this.openPanel(`solo:${b.id}`, b)
        this.scene.get(b.id)?.play('wave', 1)
      },
    }))

    const sections: PaletteSection[] = [
      { title: 'Bots', items: botItems },
      {
        title: 'Actions',
        items: [
          { icon: '♪', label: 'Everyone dance', run: () => [...this.bots.keys()].forEach((id) => this.scene.get(id)?.play('dance', 2.2)) },
          { icon: '✦', label: 'Everyone celebrate', run: () => [...this.bots.keys()].forEach((id) => this.scene.get(id)?.play('celebrate', 1.4)) },
          { icon: '▣', label: 'New room', run: () => this.createRoom() },
          { icon: '▤', label: 'Open Hermes', run: () => this.send({ type: 'open-app' }) },
          { icon: '◌', label: 'Close overlay', run: () => this.send({ type: 'close' }) },
        ],
      },
    ]

    showPalette(this.root, sections)
  }
}

function statusColor(status: Bot['status']): string {
  return status === 'working' ? '#4ef0c0' : status === 'sleeping' ? '#8b93b0' : '#7c5cff'
}

export function mountBotRoom(host: HTMLElement): Stage {
  const send = (msg: ContentToSw) => window.hermesDesktop.botroom.control(msg)
  const stage = new Stage(host, send)

  window.hermesDesktop.botroom.onState((payload) => stage.handle(payload as SwToContent))
  send({ type: 'ready' })

  return stage
}
