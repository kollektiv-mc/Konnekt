import type { ComponentPropsWithoutRef } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeRaw from 'rehype-raw'
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize'
import type { Options as SanitizeSchema } from 'rehype-sanitize'
import { BrowserOpenURL } from '../../../wailsjs/runtime/runtime'

type AnchorProps = ComponentPropsWithoutRef<'a'>

// A mod body is the one place remote, third-party HTML reaches this WebView,
// and the WebView is same-origin with the Wails bridge: a `<iframe srcdoc>`
// that rehype-raw let through could call `parent.window.go.main.App.*` and
// reach every bound method from a mod listing (#306). React neutralises
// `<script>` and string `on*` handlers on its own; it does nothing about
// `<iframe>`, `<object>`, `<meta http-equiv>` or `<style>`, so the tree is
// sanitized after rehype-raw parses it and before it renders. The schema is
// rehype-sanitize's GitHub one: headings, links (http, https, mailto),
// images (http, https), code with a `language-*` class, tables, `<details>`,
// `<div>` and `<span>`, and it strips `id`/`name` to `user-content-*`. An
// element outside it is unwrapped and its children kept, which is what a
// `<center>` should do. `<style>` is added to the strip list: unwrapped, its
// CSS would be rendered as prose. The CSP in index.html is the second layer,
// so a gap in the schema has nowhere to load a frame or an object from.
const schema: SanitizeSchema = {
  ...defaultSchema,
  strip: [...(defaultSchema.strip ?? []), 'style'],
}

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
        rehypePlugins={[rehypeRaw, [rehypeSanitize, schema]]}
        components={{ a: MarkdownLink }}
      >
        {body}
      </ReactMarkdown>
    </div>
  )
}
