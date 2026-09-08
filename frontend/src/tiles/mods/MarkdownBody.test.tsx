import { describe, it, expect, vi } from 'vitest'
import { render } from '@testing-library/react'
import { MarkdownBody } from './MarkdownBody'

vi.mock('../../../wailsjs/runtime/runtime')

// Each of these passes rehype-raw untouched and, without the sanitizer, lands
// in a document that is same-origin with the Wails bridge (#306). The srcdoc
// frame is the one that matters: same-origin, so `parent.window.go` is its.
const HOSTILE = [
  '<iframe srcdoc="<script>parent.window.go.main.App.StopServer()</script>"></iframe>',
  '<object data="https://evil.example/x.swf"></object>',
  '<embed src="https://evil.example/x.swf">',
  '<script>window.pwned = true</script>',
  '<style>.mod-body { display: none }</style>',
  '<meta http-equiv="refresh" content="0;url=https://evil.example">',
  '<base href="https://evil.example/">',
  '<form action="https://evil.example"><input type="text" name="q"></form>',
  '<img src="https://evil.example/x.png" onerror="alert(1)">',
  '<a href="javascript:alert(1)">click me</a>',
  '<div style="position:fixed;inset:0;background:red">overlay</div>',
].join('\n\n')

// The shapes Modrinth bodies actually use, so the schema is known to keep
// them: raw HTML alignment wrappers, collapsibles and sized images alongside
// the GFM the markdown half produces.
const LEGITIMATE = `
<div align="center">
  <img src="https://cdn.modrinth.com/data/abc/icon.png" width="120" alt="icon">
</div>

## Installation

Drop the jar into \`mods/\`, see the [wiki](https://example.com/wiki) or write to <a href="mailto:dev@example.com">the author</a>.

\`\`\`java
public class Hello {}
\`\`\`

| Loader | Version |
| ------ | ------- |
| Fabric | 1.21    |

<details>
<summary>Changelog</summary>

- Fixed a crash
</details>
`

describe('MarkdownBody', () => {
  it('keeps embedding, scripting and navigation elements out of the DOM', () => {
    const { container } = render(<MarkdownBody body={HOSTILE} />)

    expect(
      container.querySelector('iframe, object, embed, script, style, meta, base, form'),
    ).toBeNull()
    // The schema keeps `<input>` for GFM task lists and forces it into the one
    // shape that cannot take input: a disabled checkbox.
    const input = container.querySelector('input')
    expect(input?.getAttribute('type')).toBe('checkbox')
    expect(input?.hasAttribute('disabled')).toBe(true)
    expect(container.querySelector('[onerror]')).toBeNull()
    expect(container.querySelector('[style]')).toBeNull()
    // Unwrapped rather than stripped, so the text survives without its href.
    const link = container.querySelector('a')
    expect(link?.textContent).toBe('click me')
    expect(link?.getAttribute('href')).toBeNull()
    // `<style>` is stripped rather than unwrapped, or its CSS reads as prose.
    expect(container.textContent).not.toContain('display: none')
    // Unwrapping keeps the overlay's text, which is the harmless half of it.
    expect(container.textContent).toContain('overlay')
    expect(window).not.toHaveProperty('pwned')
  })

  it('keeps the HTML and GFM a mod body is made of', () => {
    const { container } = render(<MarkdownBody body={LEGITIMATE} />)

    const img = container.querySelector('img')
    expect(img?.getAttribute('src')).toBe('https://cdn.modrinth.com/data/abc/icon.png')
    expect(img?.getAttribute('width')).toBe('120')
    expect(container.querySelector('div[align="center"]')).not.toBeNull()
    expect(container.querySelector('h2')?.textContent).toBe('Installation')
    const hrefs = [...container.querySelectorAll('a')].map((a) => a.getAttribute('href'))
    expect(hrefs).toEqual(['https://example.com/wiki', 'mailto:dev@example.com'])
    expect(container.querySelector('code.language-java')?.textContent).toContain('class Hello')
    expect(container.querySelector('table td')?.textContent).toBe('Fabric')
    expect(container.querySelector('details > summary')?.textContent).toBe('Changelog')
    expect(container.querySelector('details li')?.textContent).toBe('Fixed a crash')
  })

  it('drops image sources that are not http(s)', () => {
    const { container } = render(
      <MarkdownBody body='<img src="data:image/svg+xml,<svg onload=alert(1)>" alt="x">' />,
    )
    expect(container.querySelector('img')?.getAttribute('src')).toBeNull()
  })
})
