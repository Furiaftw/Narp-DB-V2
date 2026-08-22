import { registerSW } from 'virtual:pwa-register';

/*
 * Surfaces new deploys instead of leaving them silent. The service worker
 * itself only checks for an update when the browser feels like it (mainly
 * on navigation) — a tab left open for hours picks up nothing on its own,
 * which is exactly what made two rounds of "the new features aren't there"
 * reports (both were actually old builds still running in an open tab).
 *
 * `registerType: 'prompt'` (vite.config.js) means the new service worker
 * installs in the background but does NOT take over automatically; nothing
 * changes for the user until they click Refresh in the UpdateBanner below.
 * A silent auto-reload would be worse here — it would drop whatever the
 * user was mid-typing (a jutsu submission, a chat reply) without warning.
 */

let listeners = [];
let applySW = null;

export function initPWAUpdate() {
  applySW = registerSW({
    immediate: true,
    onNeedRefresh() {
      listeners.forEach(fn => fn(true));
    },
    onRegisteredSW(_swUrl, registration) {
      if (!registration) return;
      // The browser only auto-checks for a new SW on navigation, so a tab
      // kept open across a deploy would otherwise never find out. Poll for
      // it directly instead.
      setInterval(() => {
        registration.update().catch(() => {});
      }, 30 * 60 * 1000);
      const onVisible = () => {
        if (document.visibilityState === 'visible') registration.update().catch(() => {});
      };
      document.addEventListener('visibilitychange', onVisible);
    },
  });
}

export function subscribeToPWAUpdate(fn) {
  listeners.push(fn);
  return () => { listeners = listeners.filter(l => l !== fn); };
}

export function applyPWAUpdate() {
  applySW?.(true);
}
