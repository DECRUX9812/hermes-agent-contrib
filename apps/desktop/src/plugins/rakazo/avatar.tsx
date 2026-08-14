import { cn } from '@hermes/plugin-sdk'

interface BotAvatarProps {
  color?: string
  size?: number
  className?: string
}

export function BotAvatar({ color = '#6A6BF5', size = 38, className }: BotAvatarProps) {
  const visorW = Math.round(size * 0.68)
  const visorH = Math.round(size * 0.4)
  const dot = Math.max(3, Math.round(size * 0.09))
  const gap = Math.max(3, Math.round(size * 0.12))

  return (
    <div
      className={cn('flex flex-none items-center justify-center rounded-full shadow-inner', className)}
      style={{
        width: size,
        height: size,
        backgroundColor: color,
        boxShadow: 'inset 0 1px 2px rgba(255,255,255,0.25), 0 2px 6px rgba(0,0,0,0.3)',
      }}
    >
      <div
        className="flex items-center justify-center"
        style={{
          width: visorW,
          height: visorH,
          borderRadius: Math.round(visorH * 0.55),
          backgroundColor: 'rgba(12, 12, 14, 0.82)',
          gap,
        }}
      >
        <span
          className="rounded-full bg-white shadow-[0_0_4px_rgba(255,255,255,0.8)]"
          style={{ width: dot, height: dot }}
        />
        <span
          className="rounded-full bg-white shadow-[0_0_4px_rgba(255,255,255,0.8)]"
          style={{ width: dot, height: dot }}
        />
      </div>
    </div>
  )
}
