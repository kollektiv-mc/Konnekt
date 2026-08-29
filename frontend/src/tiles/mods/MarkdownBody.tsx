import type { ComponentPropsWithoutRef } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeRaw from 'rehype-raw'
import { BrowserOpenURL } from '../../../wailsjs/runtime/runtime'

type AnchorProps = ComponentPropsWithoutRef<'a'>

function MarkdownLink({ href, children, ...rest }: AnchorProps) {
  const external = !!href && /^https?:\/\//i.test(href)
  return (
    <a
      href={href}
      {...rest}
      onClick={(e) => {
        if (!external) return
        e.preventDefault()
        try {
          BrowserOpenURL(href!)
        } catch {
          /* non-Wails context (e.g. pnpm dev preview) */
        }
      }}
    >
      {children}
    </a>
  )
}

export function MarkdownBody({ body }: { body: string }) {
  return (
    <div className="mod-body">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeRaw]}
        components={{ a: MarkdownLink }}
      >
        {body}
      </ReactMarkdown>
    </div>
  )
}
