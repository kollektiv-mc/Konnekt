import React from 'react'
import { createRoot } from 'react-dom/client'
import './style.css'
import App from './App'
import { ErrorBoundary } from './components/ErrorBoundary'
import { SplashScreen } from './components/SplashScreen'
import { applyScrollbarWidth } from './lib/scrollbar'

// Before first paint, so `.scroll-stable` in style.css can net the gutter this
// platform actually reserves out of its padding rather than a guess at it.
applyScrollbarWidth()
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
