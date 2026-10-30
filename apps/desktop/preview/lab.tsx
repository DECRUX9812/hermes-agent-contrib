/**
 * Design lab — DEV ONLY. Four candidate treatments for the session tab strip,
 * rendered on the real theme tokens at 1:1 so they can be compared on pixels.
 */
import '@/styles.css'

import { createRoot } from 'react-dom/client'

import { Codicon } from '@/components/ui/codicon'
import { cn } from '@/lib/utils'
import { DEFAULT_TYPOGRAPHY, nousTheme } from '@/themes/presets'

function paintTheme() {
  const root = document.documentElement
  const c = nousTheme.colors
  const typo = { ...DEFAULT_TYPOGRAPHY, ...nousTheme.typography }
  root.dataset.hermesTheme = 'nous'
  root.dataset.hermesMode = 'light'

  for (const [k, v] of Object.entries({
    '--theme-foreground': c.foreground,
    '--theme-primary': c.primary,
    '--theme-secondary': c.secondary,
    '--theme-accent-soft': c.accent,
    '--theme-midground': c.midground ?? c.ring,
    '--theme-warm': c.primary,
    '--theme-background-seed': c.background,
    '--theme-sidebar-seed': c.sidebarBackground ?? c.background,
    '--theme-card-seed': c.card,
    '--theme-elevated-seed': c.popover,
    '--theme-bubble-seed': c.userBubble ?? c.popover,
    '--dt-primary-foreground': c.primaryForeground,
    '--dt-secondary-foreground': c.secondaryForeground,
    '--dt-accent-foreground': c.accentForeground,
    '--dt-border': c.border,
    '--dt-input': c.input,
    '--dt-ring': c.ring,
    '--dt-base-size': typo.baseSize ?? '15px',
    '--dt-line-height': String(typo.lineHeight ?? 1.55),
    '--dt-letter-spacing': typo.letterSpacing ?? '0em'
  })) {
    root.style.setProperty(k, v as string)
  }
}

paintTheme()

const TITLES = ['Complete Hermes in-app browser', 'Fix duplicate message bug', 'Swarm cockpit pass']

function Dot({ tone }: { tone: 'action' | 'attention' | 'idle' }) {
  return (
    <span
      className={cn(
        'block size-[6px] shrink-0 rounded-full',
        tone === 'action' && 'bg-(--theme-primary)',
        tone === 'attention' && 'bg-(--ui-orange)',
        tone === 'idle' && 'bg-(--ui-text-quaternary)'
      )}
    />
  )
}

function Close() {
  return (
    <span className="grid size-4 place-items-center rounded-[4px] text-(--ui-text-quaternary) transition-colors hover:bg-(--ui-control-hover-background) hover:text-(--ui-text-secondary)">
      <Codicon name="close" size="10px" />
    </span>
  )
}

function Tools() {
  return (
    <div className="flex shrink-0 items-center gap-0.5 pr-2.5">
      <span className="mx-1 h-3.5 w-px bg-(--ui-stroke-tertiary)" />
      {['globe', 'gear', 'split-horizontal', 'arrow-swap', 'layout-sidebar-right'].map((n, i) => (
        <span
          className={cn(
            'grid size-6 place-items-center rounded-[6px] text-(--ui-text-tertiary)',
            i === 4 && 'ml-1'
          )}
          key={n}
        >
          <Codicon name={n} size="14px" />
        </span>
      ))}
    </div>
  )
}

/** A — card tabs with a rounded accent bar inside the active tab. */
function VariantA() {
  return (
    <Strip>
      {TITLES.map((title, i) => (
        <div
          className={cn(
            'relative my-[3px] flex h-[calc(100%-6px)] max-w-[13.5rem] min-w-[7.5rem] items-center gap-2 rounded-[7px] px-2.5 text-[12px] font-medium',
            i === 0
              ? 'bg-(--ui-bg-elevated) text-(--ui-text-primary) shadow-[0_1px_2px_rgba(0,0,0,0.07),0_0_0_1px_var(--ui-stroke-tertiary)]'
              : 'text-(--ui-text-tertiary)'
          )}
          key={title}
        >
          <Dot tone={i === 0 ? 'action' : i === 1 ? 'attention' : 'idle'} />
          <span className="min-w-0 flex-1 truncate">{title}</span>
          {i === 0 ? <Close /> : null}
          {i === 0 ? (
            <span className="pointer-events-none absolute inset-x-2 bottom-[3px] h-[2px] rounded-full bg-(--theme-primary)" />
          ) : null}
        </div>
      ))}
      <span className="my-[3px] grid size-6 shrink-0 place-items-center rounded-[7px] text-(--ui-text-tertiary)">
        <Codicon name="add" size="14px" />
      </span>
      <div className="flex-1" />
      <Tools />
    </Strip>
  )
}

/** B — merged tabs: active card is the content surface, no accent bar. */
function VariantB() {
  return (
    <Strip>
      {TITLES.map((title, i) => (
        <div
          className={cn(
            'my-[3px] flex h-[calc(100%-6px)] max-w-[13.5rem] min-w-[7.5rem] items-center gap-2 rounded-[7px] px-2.5 text-[12px] font-medium',
            i === 0
              ? 'bg-(--ui-editor-surface-background) text-(--ui-text-primary) shadow-[0_0_0_1px_var(--ui-stroke-tertiary),0_-2px_0_0_var(--theme-primary)_inset]'
              : 'text-(--ui-text-tertiary)'
          )}
          key={title}
        >
          <Dot tone={i === 0 ? 'action' : i === 1 ? 'attention' : 'idle'} />
          <span className="min-w-0 flex-1 truncate">{title}</span>
          {i === 0 ? <Close /> : null}
        </div>
      ))}
      <span className="my-[3px] grid size-6 shrink-0 place-items-center rounded-[7px] text-(--ui-text-tertiary)">
        <Codicon name="add" size="14px" />
      </span>
      <div className="flex-1" />
      <Tools />
    </Strip>
  )
}

/** C — soft pills, no chrome on the bar: the Arc / Raycast read. */
function VariantC() {
  return (
    <Strip>
      {TITLES.map((title, i) => (
        <div
          className={cn(
            'my-[4px] flex h-[calc(100%-8px)] max-w-[13rem] min-w-[7rem] items-center gap-2 rounded-full px-3 text-[12px] font-medium',
            i === 0
              ? 'bg-(--ui-bg-elevated) text-(--ui-text-primary) shadow-[0_1px_1px_rgba(0,0,0,0.06),0_0_0_1px_var(--ui-stroke-quaternary)]'
              : 'text-(--ui-text-tertiary)'
          )}
          key={title}
        >
          <Dot tone={i === 0 ? 'action' : i === 1 ? 'attention' : 'idle'} />
          <span className="min-w-0 flex-1 truncate">{title}</span>
          {i === 0 ? <Close /> : null}
        </div>
      ))}
      <span className="my-[3px] grid size-6 shrink-0 place-items-center rounded-full text-(--ui-text-tertiary)">
        <Codicon name="add" size="14px" />
      </span>
      <div className="flex-1" />
      <Tools />
    </Strip>
  )
}

function Strip({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-[40px] w-full items-stretch border-b border-(--ui-stroke-quaternary) bg-(--ui-chat-surface-background) pl-2">
      {children}
    </div>
  )
}

function App() {
  return (
    <div className="min-h-screen bg-(--ui-editor-surface-background) px-0 py-0">
      <Label text="A — card tabs + inner accent bar" />
      <VariantA />
      <Label text="B — merged card, inset top accent" />
      <VariantB />
      <Label text="C — soft pills" />
      <VariantC />
      <Label text="— current (for reference)" />
      <div className="flex h-[40px] items-stretch border-b border-(--ui-stroke-quaternary) bg-(--ui-sidebar-surface-background) pl-2">
        {TITLES.map((title, i) => (
          <div
            className={cn(
              'flex h-full max-w-[12rem] items-center gap-1.5 pr-1 text-[11px] font-medium tracking-wide uppercase',
              i === 0
                ? 'text-(--ui-text-primary) shadow-[inset_0_-2px_0_var(--theme-primary)]'
                : 'text-(--ui-text-tertiary)'
            )}
            key={title}
          >
            <span className="ml-2">
              <Dot tone="action" />
            </span>
            <span className="min-w-0 truncate">{title}</span>
          </div>
        ))}
      </div>
      <div className="h-[160px] bg-(--ui-editor-surface-background)" />
    </div>
  )
}

function Label({ text }: { text: string }) {
  return <div className="px-3 pt-4 pb-1.5 text-[10.5px] font-medium tracking-[0.08em] text-(--ui-text-quaternary) uppercase">{text}</div>
}

createRoot(document.getElementById('root')!).render(<App />)
