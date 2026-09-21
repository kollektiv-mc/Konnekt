import React from 'react'
import { createRoot } from 'react-dom/client'
import './style.css'
import App from './App'
import { ErrorBoundary } from './components/ErrorBoundary'
import { SplashScreen } from './components/SplashScreen'
import { applyScrollbarWidth } from './lib/scrollbar'
import { installGlobalErrorReporting } from './lib/clientErrors'
import { useSettingsStore } from './stores/useSettingsStore'

// Before first paint, so `.scroll-stable` in style.css can net the gutter this
// platform actually reserves out of its padding rather than a guess at it.
applyScrollbarWidth()

// Before React mounts, so an error in the first render has somewhere to go.
// Forwards to konnekt.log what no ErrorBoundary catches: an exception that
// escapes to the window and a promise nobody handles (lib/clientErrors.ts).
installGlobalErrorReporting()

// Mouse-wheel scrolling on Firefox's spring physics (lib/springScroll.ts).
// A dynamic import, because nothing in it is needed to paint and the entry
// chunk's budget (`pnpm check-bundle`) is a ratchet: a notch that lands
// before the chunk arrives scrolls natively, once. The toggle is read from
// the store per notch rather than subscribed to, so a change in Settings
// applies to the next notch and the store is free to load after this runs.
void import('./lib/springScroll').then(({ installSpringScroll }) =>
  installSpringScroll({ enabled: () => useSettingsStore.getState().settings.smoothScrolling }),
)
const container = document.getElementById('root')

const root = createRoot(container!)

// Remote-mode seam: before React mounts, a remote runtime shim can polyfill
// window.go.main.App and window.runtime here so every tile works over HTTP/WS
// without per-tile changes. See agent_docs/ROADMAP.md "Remote access — Phase 2".

root.render(
  <React.StrictMode>
    <ErrorBoundary>
      <SplashScreen />
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
)
