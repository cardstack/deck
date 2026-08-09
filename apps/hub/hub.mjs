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
import { readFile, readdir } from 'node:fs/promises';
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
  { route: 'start', deck: 'app/start', title: 'this machine now, and the docs' },
  { route: 'browse', deck: 'app/browse', title: 'the depot at rest' },
  { route: 'run', deck: 'app/run', title: 'the assembled, executing thing' },
  { route: 'track', deck: 'app/track', title: 'what changed, and where' },
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
// Every demo built its depot under the name `site`, so the pins inside those
// packs say `/site/...`. Mounted here under their example names the decks
// read perfectly — bytes, hashes, diffs, history — and nothing RESOLVES,
// because `/site/ui/pills@1.0.0/pills.js` is not an address this server
// answers.
//
// That is not a bug to paper over. A pin names a depot, and moving a depot
// to a different name genuinely invalidates its pins; rewriting them at
// serve time would make the server lie about the bytes it is handing out.
//
// So each demo depot gets a SECOND mount, on its own port, under the name it
// was sealed for. Same directory, same store, no copies, no child processes,
// no rebuild — one extra listener each, and the pins are correct because
// they were always correct for that name. /browse reads them from the Hub's
// own mount, where the name is unambiguous across nine depots; /run frames
// them from their own origin, where they run.
//
// THE PORTS ARE EPHEMERAL, AND THAT IS THE WHOLE POINT.
//
// This used to claim 8801–8809 by arithmetic. Nine fixed ports is nine
// standing appointments with EADDRINUSE: leave a Hub running and start
// another, or share the machine with anything that likes 8801, and the boot
// died on an unhandled listen error. The failure was invisible in the worst
// possible way — the OLD Hub still held 8788, so the browser found a Hub,
// asked it for /_hub/origins, got nothing usable, and framed every demo at
// the Hub's own origin, where /site/ pins resolve to nothing. Nine blank
// frames and no error on screen anywhere.
//
// Port 0 asks the kernel for a port that is free, which is the only way to
// ask that has no race in it. Nothing was ever entitled to a number here:
// /_hub/origins is the contract, and it reports whatever we got.
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
    found.push({
      name: entry.name,
      dir,
      storeDir: storeDirFor(dir),
      sidecarDir: join(examplesDir, entry.name),
    });
  }
  return found;
}

// ---------------------------------------------------------------------------
// Sidecars: the demo's own server, minus the demo's own server.
//
// A demo page may legitimately need something that is NOT depot content —
// `variations` fetches /choice.json, which records what the agent proposed
// and what got promoted. That is a fact about the run, not about the
// packages, so it must not be inside a tree that gets hashed and sealed.
//
// Its demo runner answered that from memory, which meant the page could only
// ever run inside that one process. Any demo that leaves such a file beside
// its depot gets it served here, at the origin root, read-only, JSON-ish
// only. The Hub is not re-implementing nine demo servers; it is honouring one
// convention, and a demo that does not use it loses nothing.
const SIDECAR = /^\/[a-z0-9-]+\.json$/;

async function serveSidecar(depot, path, res) {
  if (!SIDECAR.test(path)) return false;
  let body;
  try {
    body = await readFile(join(depot.sidecarDir, path.slice(1)));
  } catch {
    return false;
  }
  res.writeHead(200, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  });
  res.end(body);
  return true;
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

// The second mount: each demo depot served as `site`, on its own port, so its
// own pins resolve. `createDeckServer` is cheap and these share the store on
// disk with the Hub's read-only mount — two names for one directory, which is
// exactly what the pins needed.
const origins = new Map();
const originErrors = new Map();
for (let depot of demos) {
  let server = createDeckServer({
    depots: [{ name: 'site', dir: depot.dir, storeDir: depot.storeDir }],
    fallback(req, res) {
      let path = new URL(req.url ?? '/', 'http://localhost').pathname;
      serveSidecar(depot, path, res).then((served) => {
        if (served) return;
        res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
        res.end(`no route for ${path}\n`);
      });
    },
  });
  try {
    let port = await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, () => resolve(server.address().port));
    });
    origins.set(depot.name, `http://localhost:${port}`);
  } catch (error) {
    // One depot that cannot get a listener is one demo that cannot run. It is
    // not a reason to take the other eight down with it, and it is absolutely
    // not a reason to say nothing: /run reads this and prints it where the
    // frame would have been.
    originErrors.set(depot.name, String(error.message ?? error));
    console.error(`   demo origin: ${depot.name} — ${error.message ?? error}`);
  }
}

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
    // Where each demo depot answers to its own name. /run needs this to frame
    // a demo at an origin whose pins resolve.
    if (path === '/_hub/origins') {
      let body = JSON.stringify({
        origins: Object.fromEntries(origins),
        errors: Object.fromEntries(originErrors),
      });
      res.writeHead(200, {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
      });
      return res.end(body);
    }
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

// The Hub's own port is NOT ephemeral — you have to be able to type it — so
// this is the one listener that can still collide, and it says so in words
// instead of a stack trace. An already-running Hub is the likeliest cause and
// the likeliest thing to be mistaken for a broken one.
server.once('error', (error) => {
  if (error.code !== 'EADDRINUSE') throw error;
  console.error(`\n   Port ${PORT} is taken — something is already listening.`);
  console.error(`   If it is an older Hub, stop it first; a stale one serves`);
  console.error(`   stale demo origins and every demo frame comes up blank.\n`);
  console.error(`      lsof -ti:${PORT} | xargs kill`);
  console.error(`      PORT=8789 node apps/hub/hub.mjs   # or just use another\n`);
  process.exit(1);
});

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
  console.log(`      hub${' '.repeat(20)} ${hub.dir}`);
  for (let depot of demos) {
    let where = origins.get(depot.name) ?? `unavailable — ${originErrors.get(depot.name)}`;
    console.log(`      ${depot.name.padEnd(22)} runs at ${where}`);
  }
  console.log(
    '\n   Each demo is READ at /<name>/… here and RUN at its own origin above,',
  );
  console.log(
    '   because every one of them was sealed as `site` and a pin names a depot.\n',
  );
});

for (let signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    watcher.stop?.();
    server.close();
    process.exit(0);
  });
}
