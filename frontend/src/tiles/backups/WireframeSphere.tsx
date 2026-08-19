import { useId } from 'react'

const MERIDIANS = 3

interface WireframeSphereProps {
  size?: number
  color?: string
  spinDuration?: number
}

export function WireframeSphere({
  size = 80,
  color = 'var(--sun)',
  spinDuration = 8,
}: WireframeSphereProps) {
  const uid = useId().replace(/[^a-z0-9]/gi, '') || 'sphere'
  const clipId = `sc-${uid}`
  const glowId = `sg-${uid}`
  const r = size / 2
  const cx = r
  const cy = r

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      className="block overflow-visible"
      aria-hidden="true"
    >
      <defs>
        <clipPath id={clipId}>
          <circle cx={cx} cy={cy} r={r - 0.5} />
        </clipPath>
        <radialGradient id={glowId} cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor={color} stopOpacity="0.18" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </radialGradient>
      </defs>

      {/* Glow halo */}
      <circle cx={cx} cy={cy} r={r * 1.35} fill={`url(#${glowId})`} />

      <g clipPath={`url(#${clipId})`} stroke={color} fill="none" strokeWidth="1.5" opacity="0.85">
        {/* Silhouette */}
        <circle cx={cx} cy={cy} r={r - 0.5} />

        {/* Latitude lines */}
        {[-0.55, 0, 0.55].map((frac, i) => {
          const latY = cy + frac * r
          const latRX = Math.sqrt(Math.max(0, r * r - frac * r * (frac * r)))
          return (
            <ellipse
              key={`lat-${i}`}
              cx={cx}
              cy={latY}
              rx={latRX}
              ry={latRX * 0.18}
              opacity={i === 1 ? 0.5 : 0.3}
            />
          )
        })}

        {/* Spinning meridians */}
        {Array.from({ length: MERIDIANS }, (_, k) => {
          const delay = -(k / MERIDIANS) * spinDuration
          return (
            <ellipse
              key={`mer-${k}`}
              className="backup-sphere-meridian"
              cx={cx}
              cy={cy}
              rx={r - 0.5}
              ry={r - 0.5}
              // Decorative idle spin, deliberately off-token: spinDuration is a prop, seconds not
              // milliseconds, and no shared duration would mean anything here.
              // eslint-disable-next-line no-restricted-syntax -- per-meridian spin animation computed from size/spinDuration props
              style={{
                transformOrigin: `${cx}px ${cy}px`,
                animation: `backup-sphere-spin ${spinDuration}s ${delay}s linear infinite`,
                opacity: 0.6,
              }}
            />
          )
        })}
      </g>
    </svg>
  )
}
