/**
 * Advance / Bot Mode Toggle — desktop plugin.
 *
 * Adds a persisted 🐾 Bot / ⚡ Advance switch to the top bar.
 * Bot mode (default) = chat only; nothing extra mounts.
 * Advance mode reveals:
 *   - Coding terminal (right-sidebar terminal)
 *   - Inline diff surface (reuses preview pane)
 *   - Snippet/selection palette
 *   - Agent-terminal (Antigravity-style CLI agent invocation)
 *   - Knowledge retention view (fleet ledger + memory)
 *   - **Agent mode ladder** (Shift+Tab): review → accept-edits → plan
 *   - **Review checkpoint** on every file write (default mode)
 *   - **Quick/Deep diff review** after tasks
 *   - **Artifact-first async loop**: plans, diffs, recordings as reviewable deliverables
 *   - **Portable knowledge packages** (SKILL.md-style, version-controlled, on-demand)
 *
 * No editor engine, no Monaco — just the advanced *tools* the app already has.
 */

import {
  atom,
  cn,
  Codicon,
  host,
  useValue
} from '@hermes/plugin-sdk'
import { useEffect } from 'react'
import { jsx, jsxs } from 'react/jsx-runtime'

const ID = 'advance-mode-toggle'
const STORAGE_KEY = 'advance-mode'
const LADDER_STORAGE_KEY = 'advance-mode-ladder'
const DEFAULT_MODE = 'bot'
const DEFAULT_LADDER = 'review'

// ── pure mode & ladder model (exported for tests) ───────────────────────────

/** @typedef {'bot' | 'advance'} Mode */
const VALID_MODES = new Set(['bot', 'advance'])

/** @typedef {'review' | 'accept-edits' | 'plan'} LadderMode */
const VALID_LADDER = new Set(['review', 'accept-edits', 'plan'])

/** Validate and normalize a mode value. */
function normalizeMode(value) {
  const v = String(value ?? '').trim().toLowerCase()
  return VALID_MODES.has(v) ? v : DEFAULT_MODE
}

/** Validate and normalize a ladder mode. */
function normalizeLadder(value) {
  const v = String(value ?? '').trim().toLowerCase()
  return VALID_LADDER.has(v) ? v : DEFAULT_LADDER
}

/** Toggle between the two top-level modes. */
function toggleMode(current) {
  return current === 'bot' ? 'advance' : 'bot'
}

/** Cycle the agent ladder: review → accept-edits → plan → review */
function cycleLadder(current) {
  const order = ['review', 'accept-edits', 'plan']
  const idx = order.indexOf(current)
  return order[(idx + 1) % order.length]
}

/** Human-readable label for a mode. */
function modeLabel(mode) {
  return mode === 'bot' ? '🐾 Bot' : '⚡ Advance'
}

/** Short hint for a mode (tooltip / accessibility). */
function modeHint(mode) {
  return mode === 'bot'
    ? 'Chat only — simple surface'
    : 'Advance tools — terminal, inline diff, snippets, agent-terminal, knowledge'
}

/** Ladder mode display label. */
function ladderLabel(mode) {
  const labels = {
    review: '👁 Review',
    'accept-edits': '⚡ Accept',
    plan: '📋 Plan'
  }
  return labels[mode] || mode
}

/** Ladder mode hint. */
function ladderHint(mode) {
  const hints = {
    review: 'Default — pause for inline diff before every file write',
    'accept-edits': 'Auto-approve edits/creations for rapid prototyping',
    plan: 'Prepend /plan to analyze before coding'
  }
  return hints[mode] || ''
}

/** Diff review depth. */
function diffReviewLabel(depth) {
  return depth === 'deep' ? '🔍 Deep' : '⚡ Quick'
}

// ── plugin state ────────────────────────────────────────────────────────────

/** Current top-level mode atom, persisted via storage in register(). */
const $mode = atom(DEFAULT_MODE)

/** Agent ladder mode (only relevant in advance mode), persisted. */
const $ladder = atom(DEFAULT_LADDER)

/** Diff review depth preference. */
const $diffDepth = atom('quick')

/** Module-level context ref so imperative handlers can reach storage. */
let pluginCtx = null

// ── imperative API (exposed on window for devtools / other plugins) ─────────

/** Get current top-level mode. */
function getMode() {
  return $mode.get()
}

/** Set top-level mode programmatically; returns whether it changed. */
function setMode(next) {
  const normalized = normalizeMode(next)
  const current = $mode.get()
  if (normalized === current) return false
  applyMode(normalized)
  return true
}

/** Toggle top-level mode; returns the new mode. */
function toggle() {
  const next = toggleMode($mode.get())
  applyMode(next)
  return next
}

/** Get current ladder mode. */
function getLadder() {
  return $ladder.get()
}

/** Set ladder mode; returns whether it changed. */
function setLadder(next) {
  const normalized = normalizeLadder(next)
  const current = $ladder.get()
  if (normalized === current) return false
  applyLadder(normalized)
  return true
}

/** Cycle ladder (Shift+Tab); returns the new ladder mode. */
function cycle() {
  const next = cycleLadder($ladder.get())
  applyLadder(next)
  return next
}

/** Set diff review depth. */
function setDiffDepth(depth) {
  $diffDepth.set(depth)
  try {
    pluginCtx?.storage?.set?.('advance-mode-diff-depth', depth)
  } catch { /* ignore */ }
}

/** Internal: apply top-level mode change (atom + persist + side effects). */
function applyMode(next) {
  $mode.set(next)
  try {
    pluginCtx?.storage?.set?.(STORAGE_KEY, next)
  } catch { /* ignore */ }
  if (next === 'advance') {
    // Seam 1: tell the shell to reveal advance panes
    // host.request('ui.setMode', { mode: 'advance' })
    // Seam 2: focus the coding terminal
    // host.request('terminal.focus', {})
    // Seam 3: wire floating preview to file targets
    // if (window.__floatingPreview) window.__floatingPreview.setMode('advance')
  }
}

/** Internal: apply ladder mode change (atom + persist). */
function applyLadder(next) {
  $ladder.set(next)
  try {
    pluginCtx?.storage?.set?.(LADDER_STORAGE_KEY, next)
  } catch { /* ignore */ }
}

/** Build a review checkpoint payload for a file write. */
function buildReviewCheckpoint(filePath, oldContent, newContent, ladderMode) {
  return {
    filePath,
    oldContent,
    newContent,
    ladderMode,
    autoApproved: ladderMode === 'accept-edits',
    timestamp: Date.now()
  }
}

/** Artifact types for the async loop. */
const ARTIFACT_TYPES = new Set([
  'implementation-plan',
  'diff',
  'diagram',
  'recording',
  'knowledge-package'
])

/** Create an artifact envelope. */
function createArtifact(type, payload, metadata = {}) {
  if (!ARTIFACT_TYPES.has(type)) throw new Error(`Unknown artifact type: ${type}`)
  return {
    type,
    payload,
    metadata: {
      ...metadata,
      createdAt: Date.now(),
      ladderMode: $ladder.get()
    }
  }
}

/** Knowledge package (SKILL.md-style). */
function createKnowledgePackage(name, content, version = '0.1.0') {
  return createArtifact('knowledge-package', { name, content, version }, { source: 'advance-mode' })
}

// ── components ──────────────────────────────────────────────────────────────

/** Top-bar pill switch: 🐾 Bot | ⚡ Advance */
function ModeSwitch() {
  const mode = useValue($mode)
  const hint = useValue(atom(modeHint(mode)))

  const onClick = (next) => {
    applyMode(next)
  }

  return jsxs('div', {
    className: cn(
      'mx-1 flex items-center gap-1 rounded-full',
      'border border-(--ui-stroke-secondary, #202023)',
      'bg-(--chrome-action-hover, #1e1e21)',
      'p-0.5',
      'transition-colors'
    ),
    title: hint,
    children: [
      jsx('button', {
        type: 'button',
        className: cn(
          'cursor-pointer rounded-full px-2 py-0.5 text-[0.65rem] font-medium transition-all',
          mode === 'bot'
            ? 'bg-(--ui-accent, #34d399) text-(--ui-text-primary, #f2f2f4) shadow-[0_0_8px_rgba(52,211,153,0.3)]'
            : 'text-(--ui-text-tertiary, #8a8a93) hover:text-(--ui-text-secondary, #c8c8cc)'
        ),
        onClick: () => onClick('bot'),
        'aria-pressed': mode === 'bot',
        children: '🐾 Bot'
      }),
      jsx('button', {
        type: 'button',
        className: cn(
          'cursor-pointer rounded-full px-2 py-0.5 text-[0.65rem] font-medium transition-all',
          mode === 'advance'
            ? 'bg-(--ui-accent, #f59e0b) text-(--ui-text-primary, #f2f2f4) shadow-[0_0_8px_rgba(245,158,11,0.3)]'
            : 'text-(--ui-text-tertiary, #8a8a93) hover:text-(--ui-text-secondary, #c8c8cc)'
        ),
        onClick: () => onClick('advance'),
        'aria-pressed': mode === 'advance',
        children: '⚡ Advance'
      })
    ]
  })
}

/** Agent ladder switch (only visible in advance mode): Review | Accept | Plan */
function LadderSwitch() {
  const mode = useValue($mode)
  if (mode !== 'advance') return null

  const ladder = useValue($ladder)
  const hint = useValue(atom(ladderHint(ladder)))

  return jsxs('div', {
    className: cn(
      'mx-1 flex items-center gap-1 rounded-full',
      'border border-(--ui-stroke-secondary, #202023)',
      'bg-(--chrome-action-hover, #1e1e21)',
      'p-0.5',
      'transition-colors'
    ),
    title: hint,
    children: [
      jsx('button', {
        type: 'button',
        className: cn(
          'cursor-pointer rounded-full px-2 py-0.5 text-[0.65rem] font-medium transition-all',
          ladder === 'review'
            ? 'bg-(--ui-accent, #3b82f6) text-(--ui-text-primary, #f2f2f4) shadow-[0_0_8px_rgba(59,130,246,0.3)]'
            : 'text-(--ui-text-tertiary, #8a8a93) hover:text-(--ui-text-secondary, #c8c8cc)'
        ),
        onClick: () => applyLadder('review'),
        'aria-pressed': ladder === 'review',
        children: '👁 Review'
      }),
      jsx('button', {
        type: 'button',
        className: cn(
          'cursor-pointer rounded-full px-2 py-0.5 text-[0.65rem] font-medium transition-all',
          ladder === 'accept-edits'
            ? 'bg-(--ui-accent, #f59e0b) text-(--ui-text-primary, #f2f2f4) shadow-[0_0_8px_rgba(245,158,11,0.3)]'
            : 'text-(--ui-text-tertiary, #8a8a93) hover:text-(--ui-text-secondary, #c8c8cc)'
        ),
        onClick: () => applyLadder('accept-edits'),
        'aria-pressed': ladder === 'accept-edits',
        children: '⚡ Accept'
      }),
      jsx('button', {
        type: 'button',
        className: cn(
          'cursor-pointer rounded-full px-2 py-0.5 text-[0.65rem] font-medium transition-all',
          ladder === 'plan'
            ? 'bg-(--ui-accent, #8b5cf6) text-(--ui-text-primary, #f2f2f4) shadow-[0_0_8px_rgba(139,92,246,0.3)]'
            : 'text-(--ui-text-tertiary, #8a8a93) hover:text-(--ui-text-secondary, #c8c8cc)'
        ),
        onClick: () => applyLadder('plan'),
        'aria-pressed': ladder === 'plan',
        children: '📋 Plan'
      })
    ]
  })
}

/** Diff review depth selector. */
function DiffDepthSelector() {
  const mode = useValue($mode)
  if (mode !== 'advance') return null

  const depth = useValue($diffDepth)

  return jsxs('div', {
    className: cn(
      'mx-1 flex items-center gap-1 rounded-full',
      'border border-(--ui-stroke-secondary, #202023)',
      'bg-(--chrome-action-hover, #1e1e21)',
      'p-0.5',
      'transition-colors'
    ),
    title: 'Diff review depth after tasks',
    children: [
      jsx('button', {
        type: 'button',
        className: cn(
          'cursor-pointer rounded-full px-2 py-0.5 text-[0.65rem] font-medium transition-all',
          depth === 'quick'
            ? 'bg-(--ui-accent, #34d399) text-(--ui-text-primary, #f2f2f4)'
            : 'text-(--ui-text-tertiary, #8a8a93) hover:text-(--ui-text-secondary, #c8c8cc)'
        ),
        onClick: () => setDiffDepth('quick'),
        'aria-pressed': depth === 'quick',
        children: '⚡ Quick'
      }),
      jsx('button', {
        type: 'button',
        className: cn(
          'cursor-pointer rounded-full px-2 py-0.5 text-[0.65rem] font-medium transition-all',
          depth === 'deep'
            ? 'bg-(--ui-accent, #ef4444) text-(--ui-text-primary, #f2f2f4)'
            : 'text-(--ui-text-tertiary, #8a8a93) hover:text-(--ui-text-secondary, #c8c8cc)'
        ),
        onClick: () => setDiffDepth('deep'),
        'aria-pressed': depth === 'deep',
        children: '🔍 Deep'
      })
    ]
  })
}

/** Keyboard shortcut handler (Cmd/Ctrl+Shift+M for mode, Shift+Tab for ladder). */
function KeyboardShortcuts() {
  useEffect(() => {
    const handler = (event) => {
      // Cmd/Ctrl+Shift+M toggles bot/advance
      if ((event.metaKey || event.ctrlKey) && event.shiftKey && event.key === 'M') {
        event.preventDefault()
        toggle()
      }
      // Shift+Tab cycles the ladder (only in advance mode)
      if (event.shiftKey && event.key === 'Tab' && $mode.get() === 'advance') {
        event.preventDefault()
        cycle()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  return null
}

/** Main panel contribution — renders the switch(es) in the top bar. */
function AdvanceModeTogglePanel() {
  return jsxs('div', {
    className: 'flex items-center',
    children: [
      jsx(ModeSwitch),
      jsx(LadderSwitch),
      jsx(DiffDepthSelector),
      jsx(KeyboardShortcuts)
    ]
  })
}

// ── register ────────────────────────────────────────────────────────────────

export default {
  id: ID,
  name: 'Advance Mode Toggle',
  version: '0.1.0',

  async register(ctx) {
    pluginCtx = ctx

    // Restore persisted mode
    try {
      const [savedMode, savedLadder, savedDepth] = await Promise.all([
        ctx.storage?.get?.(STORAGE_KEY),
        ctx.storage?.get?.(LADDER_STORAGE_KEY),
        ctx.storage?.get?.('advance-mode-diff-depth')
      ])
      if (savedMode) $mode.set(normalizeMode(savedMode))
      if (savedLadder) $ladder.set(normalizeLadder(savedLadder))
      // validate diff depth on restore
      if (savedDepth === 'quick' || savedDepth === 'deep') {
        $diffDepth.set(savedDepth)
      }
    } catch {
      // storage unavailable; keep defaults
    }

    // Top-bar contribution
    ctx.register?.({
      id: 'advance-mode-switch',
      area: 'topbar',
      title: 'Advance Mode Toggle',
      data: { $mode, $ladder, $diffDepth },
      render: AdvanceModeTogglePanel
    })

    // Expose imperative API on window for devtools / other plugins
    if (typeof window !== 'undefined') {
      window.__advanceModeToggle = {
        getMode,
        setMode,
        toggle,
        getLadder,
        setLadder,
        cycle,
        setDiffDepth,
        buildReviewCheckpoint,
        createArtifact,
        createKnowledgePackage
      }
    }

    // Cleanup on unload
    ctx.onDispose?.(() => {
      if (typeof window !== 'undefined') {
        window.__advanceModeToggle = null
      }
      pluginCtx = null
    })
  }
}

// ── exports for vm harness tests ────────────────────────────────────────────

globalThis.__normalizeMode = normalizeMode
globalThis.__toggleMode = toggleMode
globalThis.__normalizeLadder = normalizeLadder
globalThis.__cycleLadder = cycleLadder
globalThis.__modeLabel = modeLabel
globalThis.__modeHint = modeHint
globalThis.__ladderLabel = ladderLabel
globalThis.__ladderHint = ladderHint
globalThis.__diffReviewLabel = diffReviewLabel
globalThis.__getMode = getMode
globalThis.__setMode = setMode
globalThis.__toggle = toggle
globalThis.__applyMode = applyMode
globalThis.__getLadder = getLadder
globalThis.__setLadder = setLadder
globalThis.__cycle = cycle
globalThis.__applyLadder = applyLadder
globalThis.__setDiffDepth = setDiffDepth
globalThis.__buildReviewCheckpoint = buildReviewCheckpoint
globalThis.__createArtifact = createArtifact
globalThis.__createKnowledgePackage = createKnowledgePackage
globalThis.__AdvanceModeTogglePanel = AdvanceModeTogglePanel
globalThis.__ModeSwitch = ModeSwitch
globalThis.__LadderSwitch = LadderSwitch
globalThis.__DiffDepthSelector = DiffDepthSelector
globalThis.__$mode = $mode
globalThis.__$ladder = $ladder
globalThis.__$diffDepth = $diffDepth