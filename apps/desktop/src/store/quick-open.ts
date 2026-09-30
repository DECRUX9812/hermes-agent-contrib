import { atom } from 'nanostores'

/** ⌘P Quick Open (app/quick-open): the project file finder. */
export const $quickOpenOpen = atom(false)

export function setQuickOpenOpen(open: boolean): void {
  $quickOpenOpen.set(open)
}

export function toggleQuickOpen(): void {
  $quickOpenOpen.set(!$quickOpenOpen.get())
}
