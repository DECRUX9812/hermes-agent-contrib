export function roomDayBucket(at: number): number {
  const date = new Date(at || 0)

  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
}

export function roomDayLabel(bucket: number, labels: { today: string; yesterday: string }, now = Date.now()): string {
  const today = roomDayBucket(now)
  const yesterday = new Date(today)
  yesterday.setDate(yesterday.getDate() - 1)

  if (bucket === today) {
    return labels.today
  }

  if (bucket === yesterday.getTime()) {
    return labels.yesterday
  }

  return new Intl.DateTimeFormat(undefined, {
    day: 'numeric',
    month: 'short',
    ...(new Date(bucket).getFullYear() === new Date(now).getFullYear() ? {} : { year: 'numeric' })
  }).format(new Date(bucket))
}
