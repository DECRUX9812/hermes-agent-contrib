import { atom, onMount } from 'nanostores'

/**
 * Shared wall-clock atom for age-style labels. Rows that memo-bail on session
 * identity subscribe here, so "5m ago" actually advances without a session
 * update — DESK-028. Ticks every 30 s while at least one subscriber exists;
 * no subscription, no timer.
 */
export const $nowMinute = atom<number>(Date.now())

onMount($nowMinute, () => {
  const timer = setInterval(() => $nowMinute.set(Date.now()), 30_000)
  return () => clearInterval(timer)
})
