/**
 * In-world live displays: each desk monitor, the task wall, and the atrium
 * hologram are CanvasTextures drawn with the pixel font — the same content the
 * mod's monitor blocks render (header + colored log lines, task columns,
 * goal text).
 */

import * as THREE from 'three'

import { drawText, textWidth, wrapText } from './font'
import type { SimStore, SimTask } from './model'
import { hex, PALETTE } from './textures'

const C = PALETTE.colors

export type ScreenKind = 'monitor' | 'taskwall' | 'hologram'

// ui-style.json monitor_dark / board palettes
const MD = {
  bg_top: '#2E2925',
  bg: '#26221F',
  scanline: '#221E1B',
  header_bg: '#2E2925',
  rule: '#4A423B',
  badge_bg: '#F4EFE6',
  badge_text: '#1F1E1D',
  text: '#EDE5D7',
  muted: '#A39B8E',
  tool: '#E6C659',
  tool_arg: '#EDE5D7',
  result: '#B8CBB3',
  error: '#EA847B',
  path: '#D4B17D',
  diff_hunk: '#80D2CD',
  diff_add: '#B8CBB3',
  diff_del: '#F4A585',
  diff_ctx: '#A39B8E',
  attention: '#F4A585',
}

const BOARD = { rule: '#C9A227', label: '#F4EFE6', chip: '#E9E1D3', chip_edge: '#C9BBA3' }

const LOG_COLORS: Record<string, string> = {
  text: MD.text,
  tool: MD.tool,
  result: MD.result,
  error: MD.error,
  diff: MD.diff_hunk,
  memory: MD.path,
}

function css(c: number[] | [number, number, number]): string {
  return `rgb(${c[0] | 0},${c[1] | 0},${c[2] | 0})`
}

export class ScreenManager {
  private monitors = new Map<string, { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D; tex: THREE.CanvasTexture }>()
  private taskWall!: { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D; tex: THREE.CanvasTexture }
  private holo!: { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D; tex: THREE.CanvasTexture }
  private agentTask = new Map<string, string | null>()

  constructor(private st: SimStore) {
    st.on(ev => {
      if (ev.type === 'log' || ev.type === 'agent') {this.st.dirtyScreens.add('monitors')}
    })
  }

  /** monitor quads are created by the caller; we only manage canvases+textures */
  monitorTexture(agentId: string): THREE.CanvasTexture {
    let m = this.monitors.get(agentId)

    if (!m) {
      const canvas = document.createElement('canvas')
      canvas.width = 288
      canvas.height = 192
      const ctx = canvas.getContext('2d')!
      const tex = new THREE.CanvasTexture(canvas)
      tex.magFilter = THREE.NearestFilter
      tex.minFilter = THREE.NearestFilter
      tex.generateMipmaps = false
      tex.colorSpace = THREE.SRGBColorSpace
      m = { canvas, ctx, tex }
      this.monitors.set(agentId, m)
    }

    return m.tex
  }

  taskWallTexture(): THREE.CanvasTexture {
    if (!this.taskWall) {
      const canvas = document.createElement('canvas')
      canvas.width = 224
      canvas.height = 128
      this.taskWall = { canvas, ctx: canvas.getContext('2d')!, tex: null as unknown as THREE.CanvasTexture }
      const tex = new THREE.CanvasTexture(canvas)
      tex.magFilter = THREE.NearestFilter
      tex.minFilter = THREE.NearestFilter
      tex.generateMipmaps = false
      tex.colorSpace = THREE.SRGBColorSpace
      this.taskWall.tex = tex
    }

    return this.taskWall.tex
  }

  holoTexture(): THREE.CanvasTexture {
    if (!this.holo) {
      const canvas = document.createElement('canvas')
      canvas.width = 128
      canvas.height = 96
      this.holo = { canvas, ctx: canvas.getContext('2d')!, tex: null as unknown as THREE.CanvasTexture }
      const tex = new THREE.CanvasTexture(canvas)
      tex.magFilter = THREE.NearestFilter
      tex.minFilter = THREE.NearestFilter
      tex.generateMipmaps = false
      tex.colorSpace = THREE.SRGBColorSpace
      this.holo.tex = tex
    }

    return this.holo.tex
  }

  /** Redraw any dirty monitors + task wall + hologram. Call once per tick. */
  flush(): void {
    for (const id of [...this.st.dirtyScreens]) {
      if (id === 'monitors' || this.monitors.has(id)) {this.redrawMonitor(id)}
      this.st.dirtyScreens.delete(id)
    }

    if (this.st.taskWallDirty) {
      this.redrawTaskWall()
      this.redrawHolo()
      this.st.taskWallDirty = false
    }
  }

  private redrawMonitor(agentId: string): void {
    const m = this.monitors.get(agentId)
    const a = this.st.agents.get(agentId)

    if (!m || !a) {return}
    const { ctx, canvas } = m
    ctx.imageSmoothingEnabled = false
    // dark monitor screen + scanlines
    ctx.fillStyle = MD.bg
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.fillStyle = MD.scanline

    for (let y = 0; y < canvas.height; y += 4) {ctx.fillRect(0, y, canvas.width, 1)}
    // header bar: agent color band + name + status badge
    ctx.fillStyle = MD.header_bg
    ctx.fillRect(0, 0, canvas.width, 22)
    ctx.fillStyle = a.color
    ctx.fillRect(0, 0, 5, 22)
    ctx.fillStyle = MD.rule
    ctx.fillRect(0, 22, canvas.width, 1)
    drawText(ctx, a.name.toUpperCase(), 9, 5, 1, MD.badge_bg)
    const pill = a.activity.replace('_', ' ').toUpperCase()
    const pw = textWidth(pill, 1) + 10
    const pillColor = a.activity === 'error' ? MD.error : a.activity === 'waiting_user' || a.activity === 'blocked' ? MD.attention : a.activity === 'done' ? MD.result : MD.tool
    ctx.fillStyle = MD.bg_top
    ctx.fillRect(canvas.width - pw - 6, 5, pw, 12)
    drawText(ctx, pill, canvas.width - pw - 1, 8, 1, pillColor)
    // task line + current action
    const task = a.taskKey ? this.st.tasks.get(a.taskKey) : null
    drawText(ctx, task ? `${task.id} ${task.title}`.slice(0, 44) : 'no task', 8, 28, 1, MD.muted)
    drawText(ctx, a.detail.slice(0, 48), 8, 37, 1, MD.text)
    // log lines (newest at bottom)
    const lines: string[] = []

    for (const l of this.st.logs.get(agentId) ?? []) {
      const col = LOG_COLORS[l.kind] ?? MD.text

      for (const w of wrapText(l.text, canvas.width - 20, 1).slice(0, 3)) {lines.push(`${col}|${w}`)}
    }

    const shown = lines.slice(-15)
    shown.forEach((l, i) => {
      const [col, text] = l.split('|')
      drawText(ctx, text, 8, 50 + i * 9, 1, col)
    })

    if (shown.length === 0) {
      drawText(ctx, 'log is quiet...', 8, 50, 1, MD.muted)
    }

    m.tex.needsUpdate = true
  }

  private redrawTaskWall(): void {
    const { canvas, ctx, tex } = this.taskWall

    if (!ctx) {return}
    ctx.imageSmoothingEnabled = false
    ctx.fillStyle = '#2B2521'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.fillStyle = '#3A332D'
    ctx.fillRect(2, 2, canvas.width - 4, canvas.height - 4)
    drawText(ctx, 'TASKS', 7, 6, 1, BOARD.label)

    const cols: Array<[string, string, SimTask['state']]> = [
      ['TODO', '#A39B8E', 'todo'],
      ['DOING', '#80D2CD', 'doing'],
      ['REVIEW', '#E6C659', 'review'],
      ['DONE', '#B8CBB3', 'done'],
      ['BLOCKED', '#EA847B', 'blocked'],
    ]

    const colW = Math.floor((canvas.width - 10) / cols.length)
    cols.forEach(([label, color, state], ci) => {
      const x = 5 + ci * colW
      drawText(ctx, label, x + 2, 16, 1, color)
      ctx.fillStyle = BOARD.rule
      ctx.fillRect(x, 24, colW - 2, 1)
      let y = 28

      for (const t of this.st.tasks.values()) {
        const inCol = t.state === state || (state === 'blocked' && t.state === 'cancelled')

        if (!inCol) {continue}

        if (y > canvas.height - 16) {break}
        const a = t.assignee ? this.st.agents.get(t.assignee) : undefined
        ctx.fillStyle = BOARD.chip
        ctx.fillRect(x + 1, y, colW - 4, 15)
        ctx.fillStyle = BOARD.chip_edge
        ctx.fillRect(x + 1, y + 13, colW - 4, 2)
        ctx.fillStyle = a?.color ?? '#A39B8E'
        ctx.fillRect(x + 1, y, 3, 15)
        drawText(ctx, t.id, x + 6, y + 2, 1, '#1F1E1D')
        drawText(ctx, t.title.slice(0, 19), x + 6, y + 8, 1, '#655E55')
        y += 18
      }
    })
    tex.needsUpdate = true
  }

  private redrawHolo(): void {
    const { canvas, ctx, tex } = this.holo

    if (!ctx) {return}
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    const g = this.st.goal

    if (!g) {return}
    drawText(ctx, 'GOAL', 6, 6, 1, '#E6C659')

    for (const [i, line] of wrapText(g.text, canvas.width - 12, 1).slice(0, 4).entries()) {
      drawText(ctx, line, 6, 16 + i * 9, 1, css(hex(C.paper)))
    }

    // progress bar
    ctx.fillStyle = '#1F1E1D'
    ctx.fillRect(6, 58, canvas.width - 12, 8)
    ctx.fillStyle = '#E6C659'
    ctx.fillRect(7, 59, Math.round((canvas.width - 14) * g.progress), 6)
    const done = [...this.st.tasks.values()].filter(t => t.state === 'done').length
    const total = [...this.st.tasks.values()].filter(t => t.state !== 'cancelled').length
    drawText(ctx, total ? `${done}/${total} tasks` : g.status.toUpperCase(), 6, 70, 1, '#E6C659')
    tex.needsUpdate = true
  }

  dispose(): void {
    this.monitors.forEach(m => m.tex.dispose())
    this.taskWall?.tex.dispose()
    this.holo?.tex.dispose()
  }
}
