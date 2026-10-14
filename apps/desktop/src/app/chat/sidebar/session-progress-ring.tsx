import { useI18n } from '@/i18n'

const RADIUS = 6
const CIRCUMFERENCE = 2 * Math.PI * RADIUS

export function SessionProgressRing({ done, total, size = 12 }: { done: number; total: number; size?: number }) {
  const { t } = useI18n()
  const fraction = total > 0 ? Math.min(done / total, 1) : 0

  return (
    <svg
      aria-label={t.sidebar.row.progressRing(done, total)}
      className="shrink-0 text-fg-muted"
      height={size}
      role="img"
      viewBox="0 0 16 16"
      width={size}
    >
      <circle cx="8" cy="8" fill="none" opacity="0.25" r={RADIUS} stroke="currentColor" strokeWidth="2" />
      <circle
        className="text-brand motion-safe:transition-[stroke-dashoffset] motion-safe:duration-(--dur-base) motion-safe:ease-out-quint"
        cx="8"
        cy="8"
        data-slot="progress-arc"
        fill="none"
        r={RADIUS}
        stroke="currentColor"
        strokeDasharray={CIRCUMFERENCE}
        strokeDashoffset={CIRCUMFERENCE * (1 - fraction)}
        strokeLinecap="round"
        strokeWidth="2"
        transform="rotate(-90 8 8)"
      />
    </svg>
  )
}
