import type { ActivityTask } from '@hermes/plugin-sdk'

interface ActivityDay {
  key: string
  label: string
  tasks: ActivityTask[]
}

function dayStart(ms: number): number {
  const date = new Date(ms)
  date.setHours(0, 0, 0, 0)

  return date.getTime()
}

/** Calendar days, not 24-hour intervals: yesterday may cross a DST boundary. */
export function activityDays(
  tasks: readonly ActivityTask[],
  labels: { today: string; yesterday: string },
  now = Date.now()
): ActivityDay[] {
  const today = dayStart(now)
  const previous = new Date(today)
  previous.setDate(previous.getDate() - 1)
  const yesterday = previous.getTime()

  const timestamp = (task: ActivityTask) =>
    Number.isFinite(task.startedAt) && task.startedAt > 0 ? task.startedAt * 1000 : now

  const days = new Map<number, ActivityTask[]>()

  for (const task of [...tasks].sort((a, b) => timestamp(b) - timestamp(a))) {
    const start = dayStart(timestamp(task))
    const bucket = days.get(start)

    if (bucket) {
      bucket.push(task)
    } else {
      days.set(start, [task])
    }
  }

  return [...days.entries()].map(([start, list]) => ({
    key: String(start),
    label:
      start === today
        ? labels.today
        : start === yesterday
          ? labels.yesterday
          : new Date(start).toLocaleDateString([], { day: 'numeric', month: 'short', weekday: 'short' }),
    tasks: list
  }))
}
