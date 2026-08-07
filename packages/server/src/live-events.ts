// Live-change bus: watchers publish settled tree updates; the server fans
// them out over SSE (`/_live/events`) so a page can hot-reload without a
// manual refresh. This is HMR-lite for a no-bundler world — ESM module
// URLs don't rewrite themselves, so the default client reloads the page
// when a watched package it depends on changes.

export interface LiveChangeEvent {
  name: string;
  treeHash: string;
  version?: string;
}

export type LiveChangeListener = (event: LiveChangeEvent) => void;

export interface LiveBus {
  emit(event: LiveChangeEvent): void;
  subscribe(listener: LiveChangeListener): () => void;
}

export function createLiveBus(): LiveBus {
  let listeners = new Set<LiveChangeListener>();
  return {
    emit(event) {
      for (let listener of listeners) {
        try {
          listener(event);
        } catch {
          // A bad subscriber must not break the bus or other clients.
        }
      }
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

// Tiny client served at /_live/hmr.js — drop-in for any /live page.
export const HMR_CLIENT_SOURCE = `/* deck live HMR-lite */
(() => {
  if (typeof EventSource === 'undefined') return;
  const interested = new Set();
  const pathLive = location.pathname.match(/^\\/live\\/([a-z0-9][a-z0-9-]{0,63})/);
  if (pathLive) interested.add(pathLive[1]);
  for (const script of document.querySelectorAll('script[type="importmap"]')) {
    try {
      const map = JSON.parse(script.textContent || '{}');
      for (const value of Object.values(map.imports || {})) {
        const m = String(value).match(/^\\/live\\/([a-z0-9][a-z0-9-]{0,63})/);
        if (m) interested.add(m[1]);
      }
    } catch {}
  }
  let timer;
  let last = '';
  const banner = document.createElement('div');
  banner.setAttribute('data-deck-hmr', '');
  banner.style.cssText = [
    'position:fixed', 'top:12px', 'right:12px', 'z-index:2147483647',
    'padding:0.4rem 0.7rem', 'font:12px/1.3 ui-monospace,Menlo,monospace',
    'color:#d7ffe9', 'background:rgba(8,20,16,0.88)',
    'border:1px solid rgba(61,255,192,0.45)', 'opacity:0',
    'transition:opacity 160ms ease', 'pointer-events:none',
  ].join(';');
  document.documentElement.appendChild(banner);
  function flash(text) {
    banner.textContent = text;
    banner.style.opacity = '1';
    clearTimeout(timer);
    timer = setTimeout(() => { banner.style.opacity = '0'; }, 1200);
  }
  const es = new EventSource('/_live/events');
  es.addEventListener('change', (e) => {
    let ev;
    try { ev = JSON.parse(e.data); } catch { return; }
    if (!ev?.name || (interested.size && !interested.has(ev.name))) return;
    const key = ev.name + '@' + (ev.version || ev.treeHash || '');
    if (key === last) return;
    last = key;
    flash('deck · reloading ' + ev.name);
    // Live routes are no-store; a reload picks up new ESM bytes.
    setTimeout(() => location.reload(), 80);
  });
  es.onerror = () => { /* browser auto-reconnects */ };
})();
`;
