'use client'

// Minimal inline sparkline. Single line path on a fixed-aspect SVG.
// Linear-density styling: no axes, no labels, no gradients. The chart
// is a single faint line. Matches the dashboard's "no big cards"
// constraint - the spark sits inline with text labels at the same row
// height.

interface SparklineProps {
  values: number[]
  /** Pixel width. Default 96. */
  width?: number
  /** Pixel height. Default 22. */
  height?: number
  /** Tailwind/CSS color class for the stroke. */
  stroke?: string
}

export function Sparkline({ values, width = 96, height = 22, stroke = 'currentColor' }: SparklineProps) {
  if (!values.length) {
    return <span className="inline-block" style={{ width, height }} />
  }
  const min = Math.min(...values)
  const max = Math.max(...values)
  const range = max - min || 1
  const step = values.length > 1 ? width / (values.length - 1) : 0
  const points = values.map((v, i) => {
    const x = i * step
    const y = height - ((v - min) / range) * (height - 2) - 1
    return `${x.toFixed(1)},${y.toFixed(1)}`
  })

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className="inline-block align-middle"
      aria-hidden
    >
      <polyline
        fill="none"
        stroke={stroke}
        strokeWidth={1.25}
        strokeLinecap="round"
        strokeLinejoin="round"
        points={points.join(' ')}
      />
    </svg>
  )
}
