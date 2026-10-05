import { PANE_COPY } from '../copy'

/**
 * The label every harness-driven surface carries (architecture §11): scripted
 * notifications, their feed entries and anything a dev harness produced. Live
 * host content never renders it.
 */
export function DevBadge() {
  return (
    <span
      className="inline-flex shrink-0 items-center rounded-full border border-(--stroke-nous) bg-(--ui-bg-quaternary) px-1.5 py-px text-[10px] leading-4 font-medium tracking-wide text-(--ui-text-tertiary)"
      data-dev-harness
    >
      {PANE_COPY.devHarness}
    </span>
  )
}
