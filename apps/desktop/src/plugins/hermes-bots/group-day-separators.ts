/**
 * Room-log day separators: an arrival-ordered room log is one long river, so
 * a reply from yesterday used to sit flush against one from just now. When an
 * entry's local day differs from the previous one, the view prints a hairline
 * row — "Today" / "Yesterday" / the calendar date. Pure date math lives here;
 * the render is in `group-chat-view`.
 */

/** The local day an entry landed in, as its midnight timestamp (ms). */
export function roomDayBucket(at: number): number {
  const date = new Date(Number(at) || 0)

  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
}

/** Separator label for a day bucket, relative to `now`: "Today", "Yesterday",
 *  or the calendar date ("Oct 8", with the year only when it isn't this one). */
export function roomDayLabel(
  bucket: number,
  labels: { today: string; yesterday: string },
  now = Date.now()
): string {
  const todayBucket = roomDayBucket(now)
  // Rounded, not floored: a 23- or 25-hour DST day is still ONE day.
  const dayDelta = Math.round((todayBucket - bucket) / 86_400_000)

  if (dayDelta === 0) {
    return labels.today
  }

  if (dayDelta === 1) {
    return labels.yesterday
  }

  const sameYear = new Date(bucket).getFullYear() === new Date(now).getFullYear()

  return new Intl.DateTimeFormat(undefined, {
    day: 'numeric',
    month: 'short',
    ...(sameYear ? {} : { year: 'numeric' })
  }).format(new Date(bucket))
}
