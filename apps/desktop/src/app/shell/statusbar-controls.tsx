import { useStore } from '@nanostores/react'
import { MoreHorizontal } from 'lucide-react'
import { type ComponentProps, Fragment, memo, type ReactNode, useMemo, useState } from 'react'
import { useNavigate } from 'react-router'

import {
  ContextMenu,
  ContextMenuCheckboxItem,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuTrigger
} from '@/components/ui/context-menu'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Tip, TipKeybindLabel, Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { pluginDisplayName, splitChrome } from '@/contrib/chrome'
import { $pluginRecords, setPluginEnabled } from '@/contrib/plugins-store'
import { ContribRender } from '@/contrib/react/boundary'
import { useI18n } from '@/i18n'
import { useKeybindHint } from '@/lib/keybinds/use-keybind-hint'
import { cn } from '@/lib/utils'
import {
  $statusbarHiddenIds,
  isStatusbarLayoutDefault,
  resetStatusbarLayout,
  setStatusbarItemVisible,
  toggleStatusbarVisible
} from '@/store/statusbar-prefs'

// Shared chrome styling for interactive statusbar items (button / link / menu
// trigger). The 'text' variant intentionally omits hover/transition/disabled.
// `shrink-0` + `whitespace-nowrap` so items never squeeze below their label
// width or wrap mid-chip when the bar gets crowded — the cluster's
// `overflow-x-clip` clips whole trailing items instead of letting flexbox
// compress siblings into each other's bounds.
const STATUSBAR_ACTION_CLASS =
  'inline-flex h-full shrink-0 items-center gap-1 whitespace-nowrap rounded-none px-1.5 text-[0.6875rem] text-(--ui-text-tertiary) transition-colors hover:bg-(--chrome-action-hover) hover:text-foreground disabled:cursor-default disabled:opacity-45'

export interface StatusbarMenuItem {
  id: string
  icon?: ReactNode
  label: string
  className?: string
  disabled?: boolean
  hidden?: boolean
  href?: string
  onSelect?: () => void
  title?: string
  to?: string
}

export interface StatusbarItem {
  id: string
  /** Escape hatch: render an arbitrary node into the bar (own state, tooltip,
   *  events). When set, it OWNS the slot — label/variant/onSelect are ignored.
   *  This is how a plugin drops a full stateful React component into the bar. */
  render?: () => ReactNode
  label?: ReactNode
  detail?: ReactNode
  icon?: ReactNode
  className?: string
  disabled?: boolean
  hidden?: boolean
  href?: string
  menuAlign?: 'center' | 'end' | 'start'
  menuClassName?: string
  // A render fn receives a `close()` to dismiss the popover from inside the content.
  menuContent?: ((close: () => void) => ReactNode) | ReactNode
  menuItems?: readonly StatusbarMenuItem[]
  onSelect?: (modifiers: StatusbarSelectModifiers) => void
  /** Keybind action id — when set, the tooltip shows the label + keybind hint. */
  actionId?: string
  title?: string
  to?: string
  variant?: 'action' | 'link' | 'menu' | 'text'
  /** Plain-text name for the bar's right-click show/hide menu. When omitted,
   *  the menu falls back to `title` or a humanized `id` so plugin chips are
   *  still hideable without every plugin having to opt in. */
  toggleLabel?: string
  /** Listed in the menu but not switchable: the bar's own affordances (command
   *  center, update/version pills) would strand the user if they could be
   *  hidden from the surface that hides them. */
  lockedVisible?: boolean
  /** Owning plugin id when an extension contributed this item (`plugin:<id>`
   *  provenance, without the prefix). Drives three things the user needs:
   *  the `data-plugin-id` attribution attribute, the plugin budget in
   *  `splitChrome` (plugin items overflow before core ones), and the
   *  "Disable ⟨plugin⟩" row in the bar's own menu. Core items leave it unset. */
  plugin?: string
}

/** Human-readable name for the right-click show/hide menu. Built-ins set
 *  `toggleLabel`; plugin contributions usually only set `id` (prefixed with
 *  `<pluginId>:`) and sometimes `title` / a string `label`. Every bar item
 *  must have a name so a crowded bar can always be pared back from the menu. */
function itemMenuLabel(item: StatusbarItem): string {
  if (item.toggleLabel) {
    return item.toggleLabel
  }

  if (typeof item.label === 'string' && item.label.trim()) {
    return item.label.trim()
  }

  if (item.title?.trim()) {
    return item.title.trim()
  }

  // `forkwatch:pane` -> `Forkwatch`, `hermes-Notify-v2:notify-bell` -> `Hermes Notify V2`
  const head = item.id.split(':')[0] || item.id

  return head
    .replace(/[-_]+/g, ' ')
    .replace(/\b[a-z]/g, char => char.toUpperCase())
}

export interface StatusbarSelectModifiers {
  shiftKey: boolean
}

export type StatusbarItemSide = 'left' | 'right'
export type SetStatusbarItemGroup = (id: string, items: readonly StatusbarItem[], side?: StatusbarItemSide) => void

interface StatusbarControlsProps extends ComponentProps<'footer'> {
  leftItems?: readonly StatusbarItem[]
  items?: readonly StatusbarItem[]
}

export function StatusbarControls({ className, leftItems = [], items = [], ...props }: StatusbarControlsProps) {
  const navigate = useNavigate()
  const hiddenIds = useStore($statusbarHiddenIds)

  const visible = (item: StatusbarItem) => !item.hidden && (item.lockedVisible || !hiddenIds.includes(item.id))

  // Plugin budget: the bar is a fixed-height strip, so extension chips get
  // CHROME_PLUGIN_ROWS slots and the rest hang off the `»` overflow menu
  // instead of being clipped away by `overflow-x-clip`. Core items are never
  // counted and never moved — they are the product's own controls.
  const rightVisible = items.filter(visible)
  const { inline: rightInline, overflow: rightOverflow } = splitChrome(rightVisible, item => item.plugin ?? null)

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <footer
          className={cn(
            'flex h-5 shrink-0 items-stretch justify-between gap-2 bg-(--ui-sidebar-surface-background) px-1 py-0 text-(--ui-text-tertiary) [-webkit-app-region:no-drag]',
            className
          )}
          data-slot="statusbar"
          {...props}
        >
          {/* `overflow-x-clip` (not `overflow-x-auto`) so a wide status item — for
              example "Connecting…" on a fresh/untitled session — can't paint a
              horizontal scrollbar across the bottom of the window. Items already
              `truncate` their labels, so clipping is the right behavior. */}
          <div className="flex min-w-0 items-stretch gap-0.5 overflow-x-clip">
            {leftItems.filter(visible).map(item => renderStatusItem(item, 'left', navigate))}
          </div>
          <div className="flex min-w-0 items-stretch gap-0.5 overflow-x-clip">
            {rightInline.map(item => renderStatusItem(item, 'right', navigate))}
            {rightOverflow.length > 0 && <StatusbarOverflowMenu items={rightOverflow} navigate={navigate} />}
          </div>
        </footer>
      </ContextMenuTrigger>
      <StatusbarVisibilityMenu hiddenIds={hiddenIds} items={items} leftItems={leftItems} />
    </ContextMenu>
  )
}

/** One bar item, attributed when a plugin contributed it. The wrapper is
 *  layout-neutral (`inline-flex`, full height) and carries `data-plugin-id`, so
 *  "whose chip is this?" is answerable from the DOM — the plain contribution
 *  path could not answer it before, which is why a plugin chip read as core. */
function renderStatusItem(item: StatusbarItem, side: StatusbarItemSide, navigate: ReturnType<typeof useNavigate>) {
  const key = `${side}:${item.id}`
  const view = <StatusbarItemView item={item} navigate={navigate} />

  return item.plugin ? (
    <span className="inline-flex h-full items-stretch" data-plugin-id={item.plugin} key={key}>
      {view}
    </span>
  ) : (
    <Fragment key={key}>{view}</Fragment>
  )
}

/** Activate an item from a menu row: same semantics as clicking its chip. */
function activateStatusItem(item: StatusbarItem, navigate: ReturnType<typeof useNavigate>) {
  if (item.onSelect) {
    item.onSelect({ shiftKey: false })

    return
  }

  if (item.to) {
    navigate(item.to)

    return
  }

  if (item.href) {
    window.open(item.href, '_blank', 'noreferrer')
  }
}

/** The bar's overflow affordance. Plugin chips past the budget live here
 *  instead of being clipped by the cluster's `overflow-x-clip`; the `»` is a
 *  menu rather than a scrollbar because the bar is 20px tall, so anything that
 *  doesn't fit can never be scrolled to. */
function StatusbarOverflowMenu({
  items,
  navigate
}: {
  items: readonly StatusbarItem[]
  navigate: ReturnType<typeof useNavigate>
}) {
  const records = useStore($pluginRecords)

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          aria-label={`${items.length} more status items`}
          className={STATUSBAR_ACTION_CLASS}
          data-slot="statusbar-overflow"
          type="button"
        >
          <MoreHorizontal className="size-3.5" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60" side="top" sideOffset={8}>
        {items.map(item => {
          const pluginName = item.plugin ? pluginDisplayName(item.plugin, records[item.plugin]?.name) : null

          return (
            <DropdownMenuItem
              className="gap-2 text-foreground focus:bg-accent [&_svg]:size-4"
              key={item.id}
              onSelect={() => activateStatusItem(item, navigate)}
            >
              {item.icon}
              <span className="min-w-0 truncate">{itemMenuLabel(item)}</span>
              {pluginName && (
                <span className="ml-auto shrink-0 text-[0.6875rem] text-(--ui-text-quaternary)">{pluginName}</span>
              )}
            </DropdownMenuItem>
          )
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/** Right-click the bar to choose what it shows. Lists every item in bar order
 *  (left cluster then right, including plugin chips via `itemMenuLabel`), so
 *  the menu reads like the surface it edits. Hiding the whole bar lives at the
 *  bottom — VS Code puts it on the same context menu. */
function StatusbarVisibilityMenu({
  hiddenIds,
  items,
  leftItems
}: {
  hiddenIds: readonly string[]
  items: readonly StatusbarItem[]
  leftItems: readonly StatusbarItem[]
}) {
  const { t } = useI18n()
  const copy = t.shell.statusbar
  const records = useStore($pluginRecords)

  // Plugins contributing to THIS bar, with how many items each owns. The menu
  // is the one surface the user already reaches for when the bar crowds them,
  // so "which of these is an extension, and how do I turn it off?" belongs
  // here rather than three pages deep in Capabilities.
  const pluginGroups = useMemo(() => {
    const counts = new Map<string, number>()

    for (const item of [...leftItems, ...items]) {
      if (item.plugin) {
        counts.set(item.plugin, (counts.get(item.plugin) ?? 0) + 1)
      }
    }

    return [...counts.entries()]
  }, [items, leftItems])

  // Deduped by id: an item can legitimately appear in both clusters across
  // renders (contributions move sides), and a repeated checkbox would let one
  // row's toggle silently contradict the other's.
  const toggles = useMemo(() => {
    const seen = new Set<string>()

    return [...leftItems, ...items].filter(item => {
      if (item.hidden || seen.has(item.id)) {
        return false
      }

      seen.add(item.id)

      return true
    })
  }, [items, leftItems])

  return (
    <ContextMenuContent className="w-52">
      {toggles.length > 0 && (
        <>
          <ContextMenuLabel>{copy.customizeTitle}</ContextMenuLabel>
          <ContextMenuSeparator />
          {toggles.map(item => (
            <ContextMenuCheckboxItem
              checked={item.lockedVisible || !hiddenIds.includes(item.id)}
              disabled={item.lockedVisible}
              key={item.id}
              onCheckedChange={checked => setStatusbarItemVisible(item.id, checked)}
              // Radix closes the menu on select; keep it open so several items can
              // be toggled in one pass (this is a preferences surface, not a
              // command list).
              onSelect={event => event.preventDefault()}
            >
              <span className="truncate">{itemMenuLabel(item)}</span>
            </ContextMenuCheckboxItem>
          ))}
          <ContextMenuSeparator />
          {/* Attribute-then-remove: a plugin chip the user can't name is a chip
              they can only put up with. One row per contributing plugin, right
              where the user is already managing the bar. */}
          {pluginGroups.length > 0 && (
            <>
              {pluginGroups.map(([id, count]) => (
                <ContextMenuItem
                  key={`plugin:${id}`}
                  onSelect={event => {
                    event.preventDefault()
                    void setPluginEnabled(id, false)
                  }}
                >
                  <span className="truncate">
                    Disable {pluginDisplayName(id, records[id]?.name)}
                    {count > 1 ? ` (${count} items)` : ''}
                  </span>
                </ContextMenuItem>
              ))}
              <ContextMenuSeparator />
            </>
          )}
          {/* Disabled rather than hidden when nothing is customized: the row is
              also how you find out there IS a shipped layout to get back to.
              Groups with the hide row below — both act on the bar, not an item. */}
          <ContextMenuItem
            disabled={isStatusbarLayoutDefault(hiddenIds)}
            onSelect={event => {
              event.preventDefault()
              resetStatusbarLayout()
            }}
          >
            <span className="truncate">{copy.resetStatusbar}</span>
          </ContextMenuItem>
        </>
      )}
      <ContextMenuItem onSelect={toggleStatusbarVisible}>
        <span className="truncate">{copy.hideStatusbar}</span>
        <StatusbarHideHint />
      </ContextMenuItem>
    </ContextMenuContent>
  )
}

/** The live ⌘⇧S hint on the hide row — the way back once the bar is gone. */
function StatusbarHideHint() {
  const hint = useKeybindHint('view.toggleStatusbar')

  return hint ? <span className="ml-auto pl-2 text-(--ui-text-quaternary)">{hint}</span> : null
}

/** Memoized: `useStatusbarItems` rebuilds the item array whenever ANY of its
 *  inputs change, but each individual item object is usually identical across
 *  those rebuilds. Without this, one changed item (the running timer, say)
 *  re-rendered every other item in the bar — measured at 1,446 wasted renders
 *  of 2,174 during a five-tab streaming run. `navigate` is stable for the
 *  router's lifetime, so item identity is the only real input. */
const StatusbarItemView = memo(function StatusbarItemView({
  item,
  navigate
}: {
  item: StatusbarItem
  navigate: ReturnType<typeof useNavigate>
}) {
  const [menuOpen, setMenuOpen] = useState(false)

  // Render escape hatch: the contribution owns its own chrome/state/tooltip,
  // but the slot wrapper stays `shrink-0` so a plugin chip with no flex-shrink
  // class of its own can't collapse into neighboring items when the bar fills.
  if (item.render) {
    return (
      <div className="inline-flex h-full shrink-0 items-center whitespace-nowrap">
        <ContribRender render={item.render} />
      </div>
    )
  }

  const tooltipLabel = item.actionId ? <TipKeybindLabel actionId={item.actionId} text={item.title} /> : item.title

  const content = (
    <>
      {item.icon}
      {item.label && <span className="truncate">{item.label}</span>}
      {item.detail && <span className="truncate text-muted-foreground/80">{item.detail}</span>}
    </>
  )

  if (item.variant === 'menu' && (item.menuContent || !!item.menuItems?.length)) {
    // The `Tip` helper can't wrap a menu: its TooltipTrigger needs a DOM child,
    // but DropdownMenu's Root renders no element, so the hover listeners never
    // land on the button and the tooltip silently never shows. Compose the two
    // trigger Slots directly onto the same <button> instead (both asChild), the
    // way profile-switcher.tsx stacks Popover/ContextMenu/Tooltip triggers.
    const trigger = (
      <DropdownMenuTrigger asChild>
        <button className={cn(STATUSBAR_ACTION_CLASS, item.className)} disabled={item.disabled} type="button">
          {content}
        </button>
      </DropdownMenuTrigger>
    )

    return (
      <DropdownMenu onOpenChange={setMenuOpen} open={menuOpen}>
        {item.title ? (
          <TooltipProvider delayDuration={0}>
            <Tooltip>
              <TooltipTrigger asChild>{trigger}</TooltipTrigger>
              <TooltipContent>{tooltipLabel}</TooltipContent>
            </Tooltip>
          </TooltipProvider>
        ) : (
          trigger
        )}
        <DropdownMenuContent
          align={item.menuAlign ?? 'start'}
          className={cn('w-56', item.menuContent && 'p-0', item.menuClassName)}
          side="top"
          sideOffset={8}
        >
          {item.menuContent
            ? typeof item.menuContent === 'function'
              ? item.menuContent(() => setMenuOpen(false))
              : item.menuContent
            : (item.menuItems ?? [])
                .filter(menuItem => !menuItem.hidden)
                .map(menuItem => (
                  <DropdownMenuItem
                    className={cn('gap-2 text-foreground focus:bg-accent [&_svg]:size-4', menuItem.className)}
                    disabled={menuItem.disabled}
                    key={menuItem.id}
                    onSelect={() => {
                      if (menuItem.to) {
                        navigate(menuItem.to)
                      }

                      menuItem.onSelect?.()
                    }}
                  >
                    {menuItem.href ? (
                      <a
                        className="inline-flex w-full items-center gap-2"
                        href={menuItem.href}
                        rel="noreferrer"
                        target="_blank"
                      >
                        {menuItem.icon}
                        <span className="truncate">{menuItem.label}</span>
                      </a>
                    ) : (
                      <>
                        {menuItem.icon}
                        <span className="truncate">{menuItem.label}</span>
                      </>
                    )}
                  </DropdownMenuItem>
                ))}
        </DropdownMenuContent>
      </DropdownMenu>
    )
  }

  if (item.variant === 'text' && !item.onSelect && !item.to && !item.href) {
    return (
      <Tip label={tooltipLabel}>
        <div
          className={cn(
            'inline-flex h-full shrink-0 items-center gap-1 whitespace-nowrap px-1.5 text-[0.6875rem] text-(--ui-text-tertiary)',
            item.className
          )}
        >
          {content}
        </div>
      </Tip>
    )
  }

  if (item.href || item.variant === 'link') {
    return (
      <Tip label={tooltipLabel}>
        <a className={cn(STATUSBAR_ACTION_CLASS, item.className)} href={item.href} rel="noreferrer" target="_blank">
          {content}
        </a>
      </Tip>
    )
  }

  return (
    <Tip label={tooltipLabel}>
      <button
        className={cn(STATUSBAR_ACTION_CLASS, item.className)}
        disabled={item.disabled}
        onClick={event => {
          if (item.to) {
            navigate(item.to)
          }

          item.onSelect?.({ shiftKey: event.shiftKey })
        }}
        type="button"
      >
        {content}
      </button>
    </Tip>
  )
})
