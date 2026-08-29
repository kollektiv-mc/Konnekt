import { lazy, Suspense } from 'react'

interface Props {
  body: string
  description: string
  loading: boolean
}

// react-markdown with rehype-raw drags in the full HTML parser (parse5 and the
// micromark/mdast pipeline, ~650 KB of source) and only a mod description ever
// renders it, so it loads on demand rather than on every launch. Warmed during
// idle by lib/prefetch.ts, which names this exact specifier.
const MarkdownBody = lazy(() => import('./MarkdownBody').then((m) => ({ default: m.MarkdownBody })))

function Placeholder() {
  return <div className="text-text-muted animate-pulse text-xs">Loading details…</div>
}

export function ModAboutBody({ body, description, loading }: Props) {
  if (loading && !body) {
    return <Placeholder />
  }
  if (body) {
    return (
      <Suspense fallback={<Placeholder />}>
        <MarkdownBody body={body} />
      </Suspense>
    )
  }
  if (description) {
    return <p className="text-text-muted text-xs leading-relaxed">{description}</p>
  }
  return <div className="text-text-muted text-xs">No description available.</div>
}
