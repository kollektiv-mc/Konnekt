/**
 * Stand-in while the recharts chunk loads.
 *
 * Its own file rather than a local in either view: both the summary and the
 * expanded view need it, and it cannot live in `charts.tsx` — importing it from
 * there would pull the very chunk it exists to cover the wait for.
 */
export function ChartFallback() {
  return (
    <div className="text-text-faint flex h-full items-center justify-center text-xs">
      loading chart…
    </div>
  )
}
