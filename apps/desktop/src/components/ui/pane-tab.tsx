import * as React from 'react'

import { type MenuKit, renderActionItem } from '@/components/ui/actions-menu'
import { Button } from '@/components/ui/button'
import { Codicon } from '@/components/ui/codicon'
import { Tip } from '@/components/ui/tooltip'
import { translateNow } from '@/i18n'
import { isMetaClose, middleClickHandlers } from '@/lib/middle-click'
import { cn } from '@/lib/utils'

// Inset stroke for a vertical tab rail — content-facing edge.
export const PANE_TAB_STRIP_LINE_LEFT = 'shadow-[inset_1px_0_0_var(--ui-stroke-tertiary)]'
export const PANE_TAB_STRIP_LINE_RIGHT = 'shadow-[inset_-1px_0_0_var(--ui-stroke-tertiary)]'

// The tab is a soft pill that owns its own surface, not a slash of gutter
// between hard rules: sentence case, a real hover wash, and an elevated card
// for the tab you are actually looking at. Tabs sit INSIDE a padded bar, so
// their height comes from the strip and the pill never touches the edges.
const TAB =
  'group/tab relative flex shrink-0 items-center select-none rounded-(--chrome-radius-tab) [-webkit-app-region:no-drag] transition-[background-color,color,box-shadow] duration-100 ease-out'

// Full height of the padded row: the strip's own vertical padding is the gap.
const TAB_HORIZONTAL = 'h-full min-w-0 max-w-52 text-xs font-medium'

// Room for the close chip at the right edge — a floor, so a short label pays
// nothing and a long one ellipsizes before it reaches the chip.
const TAB_CLOSEABLE = 'min-w-20 pr-1'

const TAB_VERTICAL =
  'w-full max-h-48 justify-center rounded-none not-first:border-t not-first:border-t-(--ui-stroke-quaternary) [writing-mode:vertical-rl]'

// Selected: the elevated card. `--pane-tab-active-bg` lets a strip pick what
// the card merges into (a preview rail merges it into the editor surface); the
// default is the raised surface, so selection never reads as "same as the bar".
const TAB_ACTIVE =
  'text-(--ui-text-primary) [--tab-bg:var(--pane-tab-active-bg,var(--ui-bg-elevated))] bg-(--tab-bg) shadow-[var(--shadow-sm),0_0_0_1px_var(--ui-stroke-tertiary)]'

// Idle: no surface at all — the bar reads as one piece until a tab is picked.
const TAB_IDLE =
  'text-(--ui-text-tertiary) [--tab-bg:var(--pane-tab-strip-bg,var(--ui-sidebar-surface-background))] hover:bg-(--ui-control-hover-background) hover:text-(--ui-text-secondary)'


// A tab riding a multi-tab selection: an accent wash over whatever surface the
// tab sits on. A background-image gradient (not a shadow) so it stacks cleanly
// over `--tab-bg` without fighting the active underline / hover shadows.
const TAB_SELECTED =
  '[background-image:linear-gradient(color-mix(in_srgb,var(--ui-accent)_14%,transparent),color-mix(in_srgb,var(--ui-accent)_14%,transparent))] text-foreground'

// Segmented control (a sidebar's mode switcher): a small inset pill on a
// recessed track. Same primitive, quieter voice — so a view switcher never
// reads as a second row of document tabs beside the real ones.
const SEGMENT = 'h-5.5 min-w-0 flex-1 justify-center rounded-(--chrome-radius-segment) px-2 text-(--chrome-text-switcher) font-medium'
const SEGMENT_ACTIVE = 'bg-(--ui-bg-elevated) text-(--ui-text-primary) shadow-[var(--shadow-xs)]'
const SEGMENT_IDLE = 'text-(--ui-text-secondary) hover:text-(--ui-text-primary)'

interface PaneTabProps extends React.ComponentProps<'div'> {
  active?: boolean
  dirty?: boolean
  /** Close verb. Horizontal tabs reveal a hover ✕ over the label's masked
   *  right edge; middle-click and ⌘-click always work,
   *  and stay the only gestures on vertical rails (no room for a chip ✕).
   *  There is no way to take the ✕ off a tab that HAS this verb: the chip and
   *  the pointer gestures are one affordance, so a closeable tab always says
   *  so. Omit `onClose` to make a tab uncloseable. */
  onClose?: () => void
  /** Part of a multi-tab selection (⌥/Ctrl-click, Shift-click) — an accent
   *  wash marks every tab that a drag would carry, Chrome-style. */
  selected?: boolean
  /** Vertical rail form (collapsed sidebar zones). */
  vertical?: boolean
  /** Segmented-control form: the small mode switcher a sidebar group wears
   *  (Sessions / Bots). Same primitive, different voice — an inset pill on a
   *  recessed track, never a second row of document tabs. */
  segmented?: boolean
  /** Content-facing edge of a vertical rail — the strip line the active tab cuts. */
  side?: 'left' | 'right'
}

/**
 * Editor tab shell — preview rail + zone headers + collapsed vertical rails.
 *
 * Defaults need no vars: the active tab takes the editor surface, inactive the
 * sidebar one. Override `--pane-tab-active-bg` to change what the active tab
 * merges into, `--pane-tab-strip-bg` for a gutter unlike the bar around it.
 */
export const PaneTab = React.forwardRef<HTMLDivElement, PaneTabProps>(function PaneTab(
  {
    active = false,
    dirty = false,
    onClose,
    onMouseDown,
    onPointerDown,
    onPointerUp,
    onClickCapture,
    segmented = false,
    selected = false,
    vertical = false,
    side = 'left',
    children,
    className,
    ...props
  },
  ref
) {
  // Vertical rails only. Horizontal tabs draw no bottom border — the strip owns
  // that rule, and a per-tab border stacked a second translucent line over it.
  const edge = vertical ? (side === 'right' ? 'border-l' : 'border-r') : undefined
  const middle = middleClickHandlers(onClose)

  return (
    <div
      className={cn(
        TAB,
        vertical ? TAB_VERTICAL : segmented ? SEGMENT : TAB_HORIZONTAL,
        segmented
          ? active
            ? SEGMENT_ACTIVE
            : SEGMENT_IDLE
          : active
            ? TAB_ACTIVE
            : cn(TAB_IDLE, edge && `${edge}-(--ui-stroke-tertiary)`),
        !vertical && !segmented && onClose && TAB_CLOSEABLE,
        edge,
        selected && TAB_SELECTED,
        className
      )}
      data-active={active}
      data-closeable={(onClose && !vertical) || undefined}
      data-segmented={segmented || undefined}
      data-selected={selected || undefined}
      data-slot="pane-tab"
      data-vertical={vertical || undefined}
      onClickCapture={event => {
        // Sites whose tab activates on the label's own onClick (the preview
        // rail) fire it AFTER our pointerdown close — swallow that stray click
        // in the capture phase so it can't re-select the just-closed tab.
        if (onClose && isMetaClose(event)) {
          event.preventDefault()
          event.stopPropagation()
        }

        onClickCapture?.(event)
      }}
      onMouseDown={event => {
        middle.onMouseDown(event)
        onMouseDown?.(event)
      }}
      onPointerDown={event => {
        middle.onPointerDown(event)

        // ⌘-click closes. Preempt here — the tab strips activate/drag on
        // pointerdown (drag-session onTap), so we must claim the press before
        // the shell's own handler starts a drag, and skip it entirely.
        if (onClose && isMetaClose(event)) {
          event.preventDefault()
          event.stopPropagation()
          onClose()

          return
        }

        onPointerDown?.(event)
      }}
      onPointerUp={event => {
        middle.onPointerUp(event)
        onPointerUp?.(event)
      }}
      ref={ref}
      {...props}
    >
      <div
        className={cn('pane-tab-content flex h-full min-w-0 max-w-full flex-1 items-center', vertical && 'contents')}
      >
        {children}
      </div>
      {dirty && (
        <span
          aria-hidden
          className={cn(
            'pointer-events-none absolute grid size-4 place-items-center group-hover/tab:group-data-[closeable]/tab:opacity-0',
            vertical ? 'bottom-1.5 left-1/2 -translate-x-1/2' : 'right-1.5 top-1/2 -translate-y-1/2'
          )}
        >
          <span className="size-2 rounded-full bg-amber-500 shadow-[0_0_0_2px_var(--tab-bg),0_1px_2px_rgba(0,0,0,0.45)] dark:bg-amber-400" />
        </span>
      )}
      {onClose && !vertical && (
        // A real flex child, not an overlay: it reserves its own lane, so the
        // label ellipsizes before it instead of sliding underneath a fade.
        <span className="flex shrink-0 items-center pr-1">
          <button
            aria-label={translateNow('common.close')}
            className="grid size-4.5 cursor-pointer place-items-center rounded-(--chrome-radius-chip) bg-transparent text-(--ui-text-tertiary) opacity-0 outline-none transition-[opacity,background-color,color] duration-100 group-hover/tab:opacity-100 group-data-[active=true]/tab:opacity-100 hover:bg-(--ui-control-hover-background) hover:text-(--ui-text-primary) focus-visible:opacity-100"
            onClick={event => {
              event.preventDefault()
              event.stopPropagation()
              onClose()
            }}
            onPointerDown={event => {
              // Claim a plain left press so the shell can't also activate or
              // drag the tab. Middle/⌘ presses bubble on purpose — the tab's
              // own close gestures already route them.
              if (event.button === 0 && !isMetaClose(event)) {
                event.stopPropagation()
              }
            }}
            tabIndex={-1}
            type="button"
          >
            <Codicon name="close" size="0.625rem" />
          </button>
        </span>
      )}
    </div>
  )
})

interface PaneTabLabelProps extends React.ComponentProps<'button'> {
  /** `button` when the label is the activation target (preview rail);
   *  default `span` defers to the shell (zone drag/activate). */
  as?: 'button' | 'span'
}

/** Truncating label inside a `PaneTab`. `className` merges into the text span
 *  (e.g. `normal-case tracking-normal` for filenames). Sentence case, ellipsis
 *  on overflow: a tab title is prose, not a section header. */
export const PaneTabLabel = React.forwardRef<HTMLElement, PaneTabLabelProps>(function PaneTabLabel(
  { as = 'span', className, children, ...props },
  ref
) {
  const Comp = as as React.ElementType

  return (
    <Comp
      className="flex h-full min-w-0 max-w-full items-center overflow-hidden px-2.5 text-left outline-none group-data-[vertical]/tab:h-auto group-data-[vertical]/tab:w-full group-data-[vertical]/tab:justify-center group-data-[vertical]/tab:py-2"
      ref={ref}
      {...props}
    >
      <span className={cn('block min-w-0 truncate font-medium', className)}>{children}</span>
    </Comp>
  )
})

interface PaneTabStripProps extends React.ComponentProps<'div'> {
  /** The scrolling tab list — receives `role="tablist"`. */
  children: React.ReactNode
  /** Ref on the scroller itself, for `useActiveTabVisible`. */
  listRef?: React.Ref<HTMLDivElement>
  /** Non-scrolling trailing chrome pinned to the right (the minimize chevron). */
  trailing?: React.ReactNode
  /** Top-edge panel header shares the native window-control band. */
  titlebar?: boolean
  /** Recessed track for a mode switcher (see `PaneTab.segmented`). */
  segmented?: boolean
}

/**
 * The horizontal tab bar every strip in the app sits in. Owns the bar's height
 * and surface, the scroll behaviour (hidden scrollbars, contained overscroll),
 * and the pinned trailing slot — so a new strip inherits all of it instead of
 * re-deriving the geometry and drifting out of alignment.
 *
 * Tabs go in `children` as `PaneTab`s; per-strip extras (drag handlers,
 * `data-zone-tabstrip`, drop carets) ride on the usual div props.
 */
export const PaneTabStrip = React.forwardRef<HTMLDivElement, PaneTabStripProps>(function PaneTabStrip(
  { children, className, listRef, segmented = false, trailing, titlebar = false, ...props },
  ref
) {
  return (
    <div
      // The bar is a rail the tabs sit IN: it owns the surface, the row height
      // and the breathing room, so every strip (window tabs, panel headers,
      // preview rail) has the same rhythm without re-deriving it.
      className={cn(
        'group/pane-header relative flex min-w-0 shrink-0 select-none items-stretch gap-0.5 bg-(--ui-sidebar-surface-background)',
        // Window strips are a rail: a hair darker than the surfaces around them,
        // so the selected tab reads as raised, plus a hairline that closes the
        // band. Panel strips keep their own surface — a darkened header inside a
        // pane would read as a second toolbar.
        titlebar
          ? 'h-full flex-1 bg-(--pane-tab-strip-bg,var(--ui-sidebar-surface-background)) px-1.5 py-0.75 shadow-[inset_0_-1px_0_var(--ui-stroke-quaternary)] [-webkit-app-region:drag]'
          : 'h-7 px-1 py-0.5 [-webkit-app-region:no-drag]',
        segmented && 'items-center px-2',
        className
      )}
      data-segmented={segmented || undefined}
      data-titlebar={titlebar || undefined}
      ref={ref}
      {...props}
    >
      <div
        className={cn(
          'flex min-w-0 flex-1 overflow-x-auto overflow-y-hidden overscroll-x-contain [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden',
          // Neutral ink wash, not `--ui-bg-secondary`: that token carries the accent
        // tint, which reads as a blue capsule dropped into a warm sidebar.
        segmented &&
          'items-center gap-0.5 rounded-(--chrome-radius-tab) bg-[color-mix(in_srgb,var(--ui-text-primary)_6%,transparent)] p-0.5'
        )}
        ref={listRef}
        role="tablist"
      >
        {children}
      </div>
      {trailing}
    </div>
  )
})

/** A glyph button on a tab strip: the "+" and anything a pane contributes (a
 *  preview's console / DevTools). Callers pass DATA, never classes — the same
 *  contract as `TitlebarTool`, so every glyph on every strip matches. */
export interface PaneStripTool {
  active?: boolean
  disabled?: boolean
  icon: React.ReactNode
  id: string
  /** Tooltip text and accessible name. */
  label: string
  onSelect: () => void
}

/**
 * Renders one `PaneStripTool` through the app's `Button` + `Tip` primitives, the
 * way `TitlebarToolButton` does: ghost variant, no active background — state
 * reads from the glyph's own opacity, with `aria-pressed` carrying it for a11y.
 *
 * Pointerdown is claimed here so a click can never also activate or drag the
 * zone behind the strip.
 */
export function PaneStripGlyph({ active, disabled, icon, label, onSelect }: Omit<PaneStripTool, 'id'>) {
  return (
    <Tip label={label} placement="toolbar">
      <Button
        aria-label={label}
        aria-pressed={active ?? undefined}
        className={cn(
          'self-center rounded-(--chrome-radius-control) bg-transparent select-none [-webkit-app-region:no-drag]',
          active ? 'opacity-100' : 'opacity-60 hover:opacity-100'
        )}
        disabled={disabled}
        onClick={onSelect}
        onPointerDown={event => event.stopPropagation()}
        size="icon-xs"
        type="button"
        variant="ghost"
      >
        {icon}
      </Button>
    </Tip>
  )
}

/** Close-verb enablement for `paneTabCloseItems` — how many tabs each verb hits. */
export interface PaneTabCloseCounts {
  all: number
  others: number
  right: number
}

interface PaneTabCloseItemsOptions {
  counts: PaneTabCloseCounts
  /** Omit to hide Close entirely (an uncloseable tab shows no dead action). */
  onClose?: () => void
  onCloseAll: () => void
  onCloseOthers: () => void
  onCloseToRight: () => void
}

/**
 * The four close verbs every tab menu offers — Close / others / to the right /
 * all — so a tab answers a right-click the same way wherever it lives. No ⌘W
 * hint on Close: the keybind closes the FOCUSED zone's active tab, so it would
 * be a lie on the inactive tab the user actually right-clicked.
 */
export function paneTabCloseItems(
  kit: MenuKit,
  { counts, onClose, onCloseAll, onCloseOthers, onCloseToRight }: PaneTabCloseItemsOptions
) {
  return (
    <>
      {onClose &&
        renderActionItem(kit, {
          icon: 'close',
          label: translateNow('common.close'),
          onSelect: onClose
        })}
      {renderActionItem(kit, {
        disabled: !counts.others,
        icon: 'close-all',
        label: translateNow('zones.closeOthers'),
        onSelect: onCloseOthers
      })}
      {renderActionItem(kit, {
        disabled: !counts.right,
        icon: 'arrow-right',
        label: translateNow('zones.closeToRight'),
        onSelect: onCloseToRight
      })}
      {renderActionItem(kit, {
        disabled: !counts.all,
        icon: 'clear-all',
        label: translateNow('zones.closeAll'),
        onSelect: onCloseAll
      })}
    </>
  )
}
