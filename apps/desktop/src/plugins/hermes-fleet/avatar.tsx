export function HermesAvatar({
  name = 'Hermes',
  color = '#FFFFFF',
  size = 32,
  isLive = false,
}: {
  name?: string
  color?: string
  size?: number
  isLive?: boolean
}) {
  const initial = (name[0] || 'H').toUpperCase()
  return (
    <div className="relative inline-flex flex-none items-center justify-center">
      <div
        className="flex items-center justify-center rounded-full font-bold text-black select-none shadow-sm"
        style={{
          width: size,
          height: size,
          backgroundColor: '#FFFFFF',
          fontSize: size * 0.42,
          border: `1.5px solid ${color !== '#FFFFFF' ? color : 'rgba(255, 255, 255, 0.2)'}`,
        }}
      >
        {initial}
      </div>
      {isLive && (
        <span className="beacon-live absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-[#0d0e12] bg-[#10B981]" />
      )}
    </div>
  )
}
