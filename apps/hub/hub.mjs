#!/usr/bin/env node
// The Deck Hub — the front end of the Deck server.
//
//   node apps/hub/hub.mjs
//   open http://localhost:8788/
//
// Four applications over one address space (docs/deck-hub-brief.md):
//
//   /start    is it up, and what just happened
//   /browse   the depot at rest
//   /run      the assembled, executing thing
//   /read     the protocol, taught
//
// They are NOT depots. They are four decks in one depot named `hub`, which
// is what lets them share components at ordinary deck addresses instead of
// through a bundler. The Hub is served by the same read-only server it is a
// front end for, and it hot-reloads through the same watcher, because it is
// made of the same kind of thing as everything else the server holds.
//
// THE ROUTE ALIASES ARE NOT A SPECIAL CASE. `/browse` is a legal depot
// address — `SEGMENT` matches it — so the router tries `byName.get('browse')`
// first and finds nothing, then falls through here. Four redirects, no
// change to the server, and if anyone ever creates a depot actually named
// `browse` the depot wins. Real data beating a convenience alias is the
// correct precedence, and it costs nothing to get right.
import { readdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDeckServer } from '@deck/server/server';
import { storeDirFor, watchDepot } from '@deck/server/depot';
import { createHistory } from '@deck/history/create';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..');
const examplesDir = join(repoRoot, 'examples');
const PORT = Number(process.env.PORT ?? 8788);

// The Hub's own depot. Its name is the URL prefix its four apps live under.
//
// The directory is called `hub` and the depot is called `hub`, and that is
// not decoration. `depotAt()` derives a depot's name from its directory
// basename, and so does the CLI — so a directory whose name disagrees with
// the name the server mounts it under gets WRONG PINS written into its own
// tree by `deck lock`, silently, in the form of URLs for a depot that does
// not exist. The examples dodge this only because they lock programmatically
// with the name passed in. Naming the directory after the depot is the
// cheapest way to make the disagreement impossible.
const HUB = { name: 'hub', dir: join(here, 'hub') };

// The four apps, and whether they exist yet. A route that is planned and not
// built says so; it does not 404 as though it were a typo, and it does not
// quietly redirect somewhere else as though the user asked for that.
const APPS = [
  { route: 'browse', deck: 'app/browse', title: 'the depot at rest' },
  { route: 'run', deck: 'app/run', title: 'the assembled, executing thing' },
  { route: 'track', deck: 'app/track', title: 'what changed, and where' },
  { route: 'start', deck: 'app/start', title: 'this machine now, and the docs' },
];

// ---------------------------------------------------------------------------
// Real data, on purpose.
//
// A browser designed against three fixtures is a browser that breaks on the
// fourth. The nine demos have already built the hostile corpus this needs —
// 374 files in one deck, eleven packages that publish no module boundary at
// all, a 105 KB data file, two versions of one library side by side — so the
// Hub mounts their depots directly off disk and browses the real thing.
//
// One honest caveat, and it is why this is a browse-only arrangement for
// now: every demo built its depot under the name `site`, so the sealed
// import maps inside those packs say `/site/...`. Mounted here under their
// example names, those decks are readable, hashable and diffable, and their
// dependencies do NOT resolve. That is exactly the "cross-depot dependency
// refused" state from the UI spec's §12, so /browse should be showing it
// rather than hiding it. /run will need these mounted coherently, or
// proxied to the demo processes that already serve them correctly.
async function demoDepots() {
  let names;
  try {
    names = await readdir(examplesDir, { withFileTypes: true });
  } catch {
    return [];
  }
  let found = [];
  for (let entry of names.sort((a, b) => (a.name < b.name ? -1 : 1))) {
    if (!entry.isDirectory()) continue;
    let dir = join(examplesDir, entry.name, 'depot');
    try {
      await readdir(dir);
    } catch {
      continue; // no depot: `shared`, `hub`, and anything not yet run
    }
    // A depot name is a URL segment, and it must never collide with a route
    // alias — otherwise the depot would shadow the app, which is the correct
    // precedence but a confusing thing to arrange for yourself on purpose.
    if (APPS.some((app) => app.route === entry.name)) continue;
    found.push({ name: entry.name, dir, storeDir: storeDirFor(dir) });
  }
  return found;
}

// ---------------------------------------------------------------------------

// Tier-2 history is on, and `DECK_HUB_HISTORY=0` turns it off.
//
// It was briefly opt-in, because jj colocates by default and a colocated
// `.git` inside a depot that lives in another git repository makes `git add`
// record a gitlink and silently drop every file underneath. That is fixed at
// the root now — the history backend initialises non-colocated, and
// packages/history/tests/no-gitlink-test.ts fails loudly if it ever stops —
// so there is no longer a reason to run the Hub with its own live loop
// switched off.
const WANT_HISTORY = process.env.DECK_HUB_HISTORY !== '0';

let hub = {
  ...HUB,
  storeDir: storeDirFor(HUB.dir),
  history: WANT_HISTORY
    ? (
        await createHistory({
          dir: HUB.dir,
          onError: (error) => console.error(`   history: ${error}`),
        })
      ).backend
    : undefined,
};
let demos = await demoDepots();
let depots = [hub, ...demos];

const built = new Set();
for (let app of APPS) {
  try {
    await readdir(join(HUB.dir, ...app.deck.split('/')));
    built.add(app.route);
  } catch {
    // not built yet
  }
}

function redirect(res, to) {
  res.writeHead(302, { location: to, 'cache-control': 'no-store' });
  res.end();
}

function notBuilt(res, app) {
  res.writeHead(501, {
    'content-type': 'text/html; charset=utf-8',
    'cache-control': 'no-store',
  });
  res.end(
    `<!doctype html><meta charset="utf-8"><title>/${app.route} — not built yet</title>` +
      `<body style="font:14px ui-monospace,Menlo,monospace;padding:2rem;max-width:44rem">` +
      `<h1 style="font-size:1rem">/${app.route} — not built yet</h1>` +
      `<p>${app.title}. Specified in <code>docs/deck-hub-brief.md</code> §2, not yet written.</p>` +
      `<p>Built: ${[...built].map((r) => `<a href="/${r}">/${r}</a>`).join(' · ') || 'none'}</p>`,
  );
}

const server = createDeckServer({
  depots,
  fallback(req, res) {
    let path = new URL(req.url ?? '/', 'http://localhost').pathname;
    if (path === '/') {
      // Until /start exists, the front door is whatever is built.
      let first = APPS.find((app) => built.has(app.route));
      return first ? redirect(res, `/${first.route}`) : notBuilt(res, APPS[0]);
    }
    let app = APPS.find(
      (candidate) => path === `/${candidate.route}` || path === `/${candidate.route}/`,
    );
    if (app) {
      return built.has(app.route)
        ? redirect(res, `/${hub.name}/${app.deck}/`)
        : notBuilt(res, app);
    }
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end(`no route for ${path}\n`);
  },
});

// The Hub edits itself. Every save under `apps/hub/depot` auto-publishes an
// immutable prerelease, seals it if a history backend attached, and pushes a
// change event that reloads any open page. Building the tool with the tool is
// the only way to find out what using it is actually like.
let watcher = watchDepot({
  depot: hub,
  onLiveChange: (event) => server.liveBus.emit(event),
  onPublish: (event) =>
    console.log(
      `   saved → ${event.name}@${event.version}` +
        (event.sealChangeId ? ` sealed ${event.sealChangeId.slice(0, 12)}` : ''),
    ),
  onError: (error) => console.error(`   watch: ${error}`),
});
watcher.rescan();

server.listen(PORT, () => {
  console.log('\n  THE DECK HUB\n');
  console.log(`      http://localhost:${PORT}/\n`);
  for (let app of APPS) {
    console.log(
      `   ${built.has(app.route) ? '  ' : '· '}/${app.route.padEnd(7)} ${
        built.has(app.route) ? app.title : `${app.title} — not built yet`
      }`,
    );
  }
  console.log(`\n   depots mounted: ${depots.length}`);
  console.log(`      hub      ${hub.dir}`);
  for (let depot of demos) {
    console.log(`      ${depot.name.padEnd(8)} ${depot.dir}`);
  }
  console.log(
    '\n   The demo depots are mounted read-only for real browsing density.',
  );
  console.log(
    '   Their sealed import maps say /site/, so they read correctly and do',
  );
  console.log('   not resolve — which is a state /browse should be showing.\n');
});

for (let signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    watcher.stop?.();
    server.close();
    process.exit(0);
  });
}
