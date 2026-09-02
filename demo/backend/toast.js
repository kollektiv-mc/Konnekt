/* The demo's own notice, for the calls it refuses.
 *
 * Owned by the shim and injected into the DOM by it, so nothing in
 * frontend/src/ knows the demo exists. It deliberately does not use the app's
 * notification store: that store is the app's, the demo has no business
 * writing to it, and a notice about the *demo* belongs outside the product it
 * is showing.
 *
 * Styling reads the app's own CSS custom properties, which are on :root by the
 * time anything can be clicked, so the toast follows whatever skin the viewer
 * has picked instead of hard-coding one palette.
 */

const HOLD_MS = 3200;
const FADE_MS = 200;

let host = null;
let hideTimer = null;

function ensureHost() {
  if (host) return host;

  host = document.createElement("div");
  host.className = "demo-toast";
  host.setAttribute("role", "status");
  // Announced when it changes rather than interrupting: it explains why
  // nothing happened, which is not urgent.
  host.setAttribute("aria-live", "polite");

  const style = document.createElement("style");
  style.textContent = `
    .demo-toast {
      position: fixed;
      left: 50%;
      bottom: 26px;
      z-index: 2147483000;
      transform: translate(-50%, 8px);
      max-width: min(420px, calc(100vw - 32px));
      padding: 9px 14px;
      border-radius: 999px;
      border: 0.5px solid var(--border-subtle, rgba(255, 255, 255, 0.06));
      background: var(--bg-overlay, #10111a);
      box-shadow: 0 12px 32px rgba(0, 0, 0, 0.45);
      color: var(--text-secondary, rgba(255, 255, 255, 0.6));
      font-family: var(--font-mono, ui-monospace, monospace);
      font-size: 12px;
      line-height: 1.5;
      text-align: center;
      opacity: 0;
      pointer-events: none;
      transition: opacity ${FADE_MS}ms ease, transform ${FADE_MS}ms ease;
    }
    .demo-toast.is-open {
      opacity: 1;
      transform: translate(-50%, 0);
    }
    .demo-toast b {
      color: var(--accent, #4ade80);
      font-weight: inherit;
    }
    @media (prefers-reduced-motion: reduce) {
      .demo-toast { transition: none; }
    }
  `;

  document.head.appendChild(style);
  document.body.appendChild(host);
  return host;
}

/** Shows the notice. Re-showing while one is up restarts its clock. */
export function showDemoNotice(message) {
  const el = ensureHost();
  el.innerHTML = "";
  el.append(document.createTextNode(message + " "));
  const tag = document.createElement("b");
  tag.textContent = "(demo)";
  el.appendChild(tag);

  // Force a reflow so re-showing an already-open toast still animates.
  void el.offsetWidth;
  el.classList.add("is-open");

  window.clearTimeout(hideTimer);
  hideTimer = window.setTimeout(() => el.classList.remove("is-open"), HOLD_MS);
}
