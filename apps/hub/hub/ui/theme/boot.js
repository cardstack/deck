// Sync, classic script in <head> — runs before first paint / VT snapshot.
// Mirrors applyTheme() defaults in ui/nav so the palette link exists before
// the module graph. Must stay non-module so it is not deferred.
//
// `#boot` stays hidden in HTML on purpose. Showing "connecting…" on every MPA
// navigation painted a diagnostic into the View Transition and the tour.
// Only reveal after a real stall — never on the happy path.
(function () {
  var KEY = 'deck.theme';
  var known = { mocha: 1, latte: 1, 'tokyo-night-light': 1 };
  var SLOW_MS = 1600;
  var name = null;
  try {
    name = localStorage.getItem(KEY);
  } catch (_) {
    /* private mode */
  }
  if (!known[name]) {
    name = 'mocha';
  }
  document.documentElement.dataset.theme = name;
  if (!document.querySelector('link[data-role="palette"]')) {
    var link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = '/hub/theme/' + name + '/palette.css';
    link.dataset.role = 'palette';
    document.head.appendChild(link);
  }

  function appHasContent() {
    var app = document.getElementById('app');
    if (!app) return true;
    var text = (app.textContent || '').trim();
    return app.childElementCount > 0 || (text.length > 0 && text !== 'loading…');
  }

  function armSlowBoot() {
    var boot = document.getElementById('boot');
    if (!boot) return;
    boot.hidden = true;
    setTimeout(function () {
      if (appHasContent() || boot.dataset.dismissed === '1') return;
      boot.hidden = false;
    }, SLOW_MS);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', armSlowBoot);
  } else {
    armSlowBoot();
  }
})();
