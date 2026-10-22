// The website's docs, which the app links to instead of explaining itself on
// screen (.claude/rules/copy.md). Pages serves each page without its .html.

export const DOCS_URL = 'https://konnekt.pages.dev/docs'

/**
 * A scheduler block's page. The dot in a block type becomes a hyphen: Pages
 * would look up `trigger.player` as a file of that name, not as a page.
 */
export function blockDocsUrl(type: string): string {
  return `${DOCS_URL}/blocks/${type.replaceAll('.', '-')}`
}
