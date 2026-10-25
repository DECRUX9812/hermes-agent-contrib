// Responsive horizontal gutter for primary content bodies (settings right side,
// skills, artifacts, command center / sessions). Ratio-based so it scales with
// the window, but clamped so it never collapses on narrow widths or runs away
// on ultrawide displays. Headers/tabs intentionally keep their own tighter
// padding.
//
// NOTE: these must stay literal strings — Tailwind's scanner only picks up
// complete class names, so do not build them via template interpolation.
export const PAGE_INSET_X = 'px-[clamp(1.25rem,4vw,4rem)]'

// Matching negative inline-margin to bleed an element (e.g. a sticky header bar)
// out to the gutter edges before re-applying PAGE_INSET_X.
export const PAGE_INSET_NEG_X = '-mx-[clamp(1.25rem,4vw,4rem)]'

// Readable cap for overlay "inner page" bodies (settings, command center). Wide
// enough to breathe, tight enough that content doesn't sprawl on ultrawide
// displays. Pair with `mx-auto w-full` to center within the pane. Literal string
// for Tailwind's scanner (see PAGE_INSET_X note).
export const PAGE_MAX_W = 'max-w-[75rem]'

// Narrowest window that still docks a rail in the grid; under it both rails
// leave the grid and become the hover-reveal overlay. Single source of truth for
// the responsive collapse point.
//
// A rail costs ~237px (SIDEBAR_DEFAULT_WIDTH) plus the 48px activity rail, so
// the chrome is a fixed 300-odd px whatever the window does. At 900px that is a
// third of the window, and the chat beside it drops under the ~600px a dense
// transcript wants — while the composer measured 501px at 170% zoom (847px CSS)
// and 374px at 200% (720px), because the rail kept docking far below the point
// where it stopped paying for itself.
//
// 900 rather than 640 also fixes the zoom case: a 1440px window at 170% is an
// 847px viewport, so browser zoom now collapses the rail exactly like shrinking
// the window does. The cost is that a 1280px half-screen split (640px) uses the
// hover-reveal overlay instead of docking — the overlay exists for that band and
// keeps the sidebar one keystroke away (⌘B).
export const SIDEBAR_DOCK_MIN_WIDTH_PX = 900
// `max-width` is inclusive: shave a hair so an exactly-900px window docks.
export const SIDEBAR_COLLAPSE_MEDIA_QUERY = `(max-width: ${SIDEBAR_DOCK_MIN_WIDTH_PX - 0.02}px)`
