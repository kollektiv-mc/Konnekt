/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import type { Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// index.html carries the app's Content-Security-Policy (#306), and the built
// output ships it verbatim. The dev server cannot: @vitejs/plugin-react injects
// the React refresh preamble as an inline <script> and Vite's HMR client
// speaks over a websocket, both of which `script-src 'self'` refuses, so
// `wails dev` and the frontend-dev preset would open on a blank page. The tag
// is removed here in serve mode only, which keeps index.html the one place the
// policy is written and leaves every build, the demo's included, carrying it.
// The cost is that dev never runs under the policy: a resource the policy
// refuses shows up in `wails build`, not before.
function stripCspInDev(): Plugin {
  return {
    name: 'konnekt:strip-csp-in-dev',
    apply: 'serve',
    transformIndexHtml: {
      order: 'pre',
      handler: (html) =>
        html.replace(/<meta[^>]*http-equiv="Content-Security-Policy"[^>]*>\s*/i, ''),
    },
  }
}

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss(), stripCspInDev()],
  // react-draggable's internal log() reads `process.env.DRAGGABLE_DEBUG`, but Vite
  // doesn't define `process` in the browser/WebView2. Without this, the very first
  // log() call inside DraggableCore.handleDragStart throws "process is not defined",
  // aborting every drag/resize. Replacing it with a literal `false` no-ops the debug
  // log and lets drag/resize work. (react-grid-layout/react-resizable add no other
  // process.env references.)
  define: {
    'process.env.DRAGGABLE_DEBUG': 'false',
  },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    // Vitest replaces every CSS import with an empty string unless told
    // otherwise, `?raw` included, and lib/layers.test.ts reads style.css that
    // way to pin the layering scale to lib/layers.ts. Only the raw read is let
    // through, so a plain CSS import in a component still costs nothing.
    css: { include: [/\?raw$/] },
    // `pnpm test:coverage` (#287). Source only: wailsjs/ is generated and sits
    // outside src/, styles/tokens.ts is generated, main.tsx is the mount call,
    // and a test file measures nothing. The v8 provider instruments nothing at
    // build time, so `pnpm test` stays exactly as fast as it was.
    coverage: {
      provider: 'v8',
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['src/**/*.test.{ts,tsx}', 'src/styles/tokens.ts', 'src/main.tsx', 'src/**/*.d.ts'],
      reporter: ['text', 'text-summary'],
      // The floor, held the way scripts/coverage-floor holds the Go one: set a
      // few points under the first measurement, raised as coverage rises,
      // never lowered to make a build pass. Measured 2026-09-07 on 733 tests:
      // 53.7% of lines, 80.5% of branches, 49.9% of functions, with repeat
      // runs landing between 53.1% and 53.7%, so the floor leaves room for that
      // spread. Lines only, the one number the Go floor also uses, so the two
      // read the same way.
      thresholds: { lines: 50 },
    },
  },
})
