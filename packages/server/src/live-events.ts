// Live-change bus: watchers publish settled tree updates. A short-lived
// snapshot (`/_live/state`) lets any number of browser tabs observe it without
// each holding a scarce HTTP/1.1 connection open. The SSE endpoint remains a
// protocol surface for clients that deliberately want a stream.

export interface LiveChangeEvent {
  name: string;
  treeHash: string;
  version?: string;
}

export type LiveChangeListener = (event: LiveChangeEvent) => void;

export interface LiveBus {
  emit(event: LiveChangeEvent): void;
  subscribe(listener: LiveChangeListener): () => void;
  snapshot(): { sequence: number; event?: LiveChangeEvent };
}

export function createLiveBus(): LiveBus {
  let listeners = new Set<LiveChangeListener>();
  let sequence = 0;
  let latest: LiveChangeEvent | undefined;
  return {
    emit(event) {
      sequence += 1;
      latest = event;
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
    snapshot() {
      return {
        sequence,
        ...(latest ? { event: latest } : {}),
      };
    },
  };
}

// Tiny client served at /_live/hmr.js — drop-in for any live page. It polls
// the moving snapshot rather than holding one connection forever.
export const HMR_CLIENT_SOURCE = `/* deck live HMR-lite */
(() => {
  let flashTimer;
  let sequence;
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
    clearTimeout(flashTimer);
    flashTimer = setTimeout(() => { banner.style.opacity = '0'; }, 1200);
  }
  async function poll() {
    try {
      const response = await fetch('/_live/state', { cache: 'no-store' });
      if (!response.ok) throw new Error(String(response.status));
      const state = (await response.json()).data;
      if (sequence !== undefined && state.sequence > sequence && state.event) {
        flash('deck · reloading ' + state.event.name);
        // Live routes are no-store; a reload picks up new ESM bytes.
        setTimeout(() => location.reload(), 80);
        return;
      }
      sequence = state.sequence;
    } catch {}
    setTimeout(poll, 1000);
  }
  poll();
})();
`;
