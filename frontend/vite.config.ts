/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
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
  },
})
