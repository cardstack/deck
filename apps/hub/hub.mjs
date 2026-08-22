#!/usr/bin/env node
// The Deck Hub — the front end of the Deck server.
//
//   node apps/hub/hub.mjs
//   open http://localhost:8788/
//
// Five applications over one address space (docs/deck-hub-brief.md):
//
//   /start    is it up, and what just happened
//   /browse   the depot at rest
//   /run      the assembled, executing thing
//   /track    what changed, and where
//   /review   proposed changes, pull requests, and merge
//
// They are NOT depots. They are five decks in one depot named `hub`, which
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
import { readFile, readdir, rm, stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDeckServer } from '@cardstack/deck-server/server';
import { storeDirFor, watchDepot } from '@cardstack/deck-server/depot';
import { claimsDirFor } from '@cardstack/deck-server/activity';
import { createHistory } from '@cardstack/deck-history/create';
import { createRepositoryService } from './repository-service.mjs';
import {
  createEditorBridge,
  readEditable,
  seedEditable,
} from '../../examples/shared/editor-bridge.mjs';

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

// The five apps, and whether they exist yet. A route that is planned and not
// built says so; it does not 404 as though it were a typo, and it does not
// quietly redirect somewhere else as though the user asked for that.
const APPS = [
  { route: 'start', deck: 'app/start', title: 'this machine now, and the docs' },
  { route: 'browse', deck: 'app/browse', title: 'the depot at rest' },
  { route: 'run', deck: 'app/run', title: 'the assembled, executing thing' },
  { route: 'track', deck: 'app/track', title: 'what changed, and where' },
  { route: 'review', deck: 'app/review', title: 'proposed changes and merge' },
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
// So each demo depot gets a SECOND logical mount under the name it was sealed
// for. It is selected by host, not by port:
//
//   http://collaboration.localhost:8788/site/…
//
// Same directory, same store, no copies, no child processes, no extra
// listeners. Absolute `/site/…` pins stay truthful because the browser keeps
// the virtual host while resolving them. /browse uses the Hub host and the
// unambiguous example name; /run uses the example's virtual host. One Hub,
// one public port, isolated address spaces.
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
    // `examples/hub` is a miniature twin of this process for docs — same
    // depot name, empty tree. Mounting it after the real Hub made
    // `byName.get('hub')` point at the empty one, so /start…/track 404'd
    // every file that actually lives in apps/hub/hub.
    if (entry.name === 'hub') continue;
    found.push({
      name: entry.name,
      dir,
      storeDir: storeDirFor(dir),
      sidecarDir: join(examplesDir, entry.name),
      // An example that declares editable files gets an editor bridge below.
      // The declaration is the example's, so the Hub never keeps a second
      // copy of which files a reader may write.
      editable: await readEditable(join(examplesDir, entry.name)),
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

// Tier-2 History is on via deckd; `DECK_HUB_HISTORY=0` turns it off.
const WANT_HISTORY = process.env.DECK_HUB_HISTORY !== '0';
// Without DECKD_URL the Hub stays Versions-only — never a local jj watcher.
if (WANT_HISTORY && !process.env.DECKD_URL && !process.env.DECK_HISTORYD_URL) {
  console.warn(
    '   history: DECKD_URL unset — History off (run ./scripts/run-hub-with-deckd.sh)',
  );
}

let hub = {
  ...HUB,
  storeDir: storeDirFor(HUB.dir),
  history: WANT_HISTORY
    ? (
        await createHistory({
          dir: HUB.dir,
          kind: 'deckd',
          onError: (error) => console.error(`   history: ${error}`),
        })
      ).backend
    : undefined,
};
// Demo depots seal through the same deckd. /run loads History from
// `/<demo>/_history` on THIS server — without a backend attached here that
// route answers `no-history` even when seals exist on disk.
let demos = await demoDepots();
if (WANT_HISTORY) {
  demos = await Promise.all(
    demos.map(async (depot) => {
      let attachment = await createHistory({
        dir: depot.dir,
        kind: 'deckd',
        onError: (error) => console.error(`   history ${depot.name}: ${error}`),
      });
      return { ...depot, history: attachment.backend };
    }),
  );
}
let depots = [hub, ...demos];
let repositoryService = await createRepositoryService({
  depots,
  log: (message) => console.log(`   repository: ${message}`),
  onChange: (event) => server.liveBus.emit(event),
});

// The second mount: each demo depot is served as `site` on a virtual host, so
// its own pins resolve. `createDeckServer` is cheap and these share the store
// on disk with the Hub's read-only mount — two names for one directory, one
// listener for the whole product.
//
// AND THE TIMELINE HAS TO COME WITH IT.
//
// Two mounts of one directory is two mounts of one depot, so a fact about
// that directory cannot be true at one name and false at the other. It was:
// history was attached to the Hub-named mount, so `/vale-sale/_history`
// listed 45 Steps, while `/site/_history` — the origin /run actually frames —
// answered `no-history`. The tape loaded and every step in it 404'd, which is
// the worst arrangement of the two, because it looks like it works.
//
// The SAME backend object, not a second `createHistory` on the same path.
// Two clients over one timeline are two processes' worth of locking against
// one working copy. Sharing costs nothing and is also simply what is true:
// there is one timeline here.
// The write path, for the examples that have one. Not part of Deck: the deck
// server answers GET and HEAD and nothing else. The Hub's virtual-host router
// gives the example's tiny allow-listed editor adapter the same public origin,
// while the Deck server still refuses every write the adapter did not claim.
const bridges = new Map();
for (let depot of demos) {
  if (!depot.editable) continue;
  try {
    await seedEditable(depot.sidecarDir, depot.editable);
    let bridge = await createEditorBridge({
      depotDir: depot.dir,
      files: depot.editable.files,
    });
    bridges.set(depot.name, { ...bridge, files: depot.editable.files });
  } catch (error) {
    console.error(`   editor bridge: ${depot.name} — ${error.message ?? error}`);
  }
}

// Every demo virtual host gets a watcher so LIVE in /run is a real tip:
// save → publish → moving live-state snapshot → /_live/hmr.js reload.
// Controllers stay reachable for the process life via this array.
const demoWatchers = [];
const virtualServers = new Map();

for (let depot of demos) {
  let bridge = bridges.get(depot.name);
  let demoServer = createDeckServer({
    depots: [
      {
        name: 'site',
        dir: depot.dir,
        storeDir: depot.storeDir,
        history: depot.history,
      },
    ],
    action(req, res) {
      if (!bridge) return false;
      let path = new URL(req.url ?? '/', 'http://localhost').pathname;
      if (!['/write', '/revert'].includes(path)) return false;
      return bridge.respond(req, res).then(() => true);
    },
    fallback(req, res) {
      let path = new URL(req.url ?? '/', 'http://localhost').pathname;
      if (path === '/_demo/editor' && bridge) {
        res.writeHead(200, {
          'content-type': 'application/json; charset=utf-8',
          'cache-control': 'no-store',
        });
        res.end(
          JSON.stringify({
            origin: `http://${depot.name}.localhost:${PORT}`,
            files: bridge.files,
          }),
        );
        return;
      }
      if (path === '/files' && bridge) return bridge.respond(req, res);
      serveSidecar(depot, path, res).then((served) => {
        if (served) return;
        res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
        res.end(`no route for ${path}\n`);
      });
    },
  });
  virtualServers.set(depot.name, demoServer);
  // Watch every demo, not only editor-adapter ones. Historical ?step=
  // addresses stay immutable (DVR); live state reloads only the working tip.
  let watcher = watchDepot({
    depot: {
      name: 'site',
      dir: depot.dir,
      storeDir: depot.storeDir,
      history: depot.history,
    },
    onLiveChange: (event) => demoServer.liveBus.emit(event),
    onPublish: (event) =>
      console.log(
        event.reused
          ? `   ${depot.name}: ${event.name} is already published as ${event.version}`
          : `   ${depot.name}: saved → ${event.name}@${event.version}`,
      ),
    onError: (error) => console.error(`   ${depot.name} watch: ${error}`),
  });
  watcher.rescan();
  demoWatchers.push(watcher);
}

// ---------------------------------------------------------------------------
// Heat moved to protocol `GET /_activity` (packages/server activity index).
// The old `/_hub/heat` leaf dump was a 10+ MB JSON bomb and is retired below.

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
  action(req, res) {
    let path = new URL(req.url ?? '/', 'http://localhost').pathname;
    if (!path.startsWith('/_hub/repositories') && path !== '/_hub/forks') return false;
    return repositoryService.handle(req, res, path);
  },
  fallback(req, res) {
    let requested = new URL(req.url ?? '/', 'http://localhost');
    let path = requested.pathname;
    if (path.startsWith('/_hub/repositories') || path === '/_hub/forks') {
      return repositoryService.handle(req, res, path);
    }
    // Retired: use GET /_activity. Kept as a tiny stub so old bookmarks do
    // not trigger a multi-second multi-megabyte walk.
    if (path === '/_hub/heat') {
      res.writeHead(410, {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
      });
      res.end(
        JSON.stringify({
          error: 'gone',
          use: '/_activity?top=200&grain=package',
          note: 'Heat is protocol now — see docs/deck-activity-protocol.md',
        }),
      );
      return;
    }
    // Local wrap-up only — same bytes as `deck claim --clear` / deleting the
    // file. Not protocol: the Deck server stays read-only; Hub is the
    // operator console on this machine, and Release is how you remember to
    // stop an agent you started.
    if (path === '/_hub/release-claim' && req.method === 'POST') {
      return (async () => {
        let chunks = [];
        for await (let chunk of req) chunks.push(chunk);
        let body = {};
        try {
          body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
        } catch {
          res.writeHead(400, { 'content-type': 'application/json; charset=utf-8' });
          return res.end(JSON.stringify({ ok: false, error: 'bad-json' }));
        }
        let actor = String(body.actor ?? '').trim();
        if (!actor || actor.includes('/') || actor.includes('\\')) {
          res.writeHead(400, { 'content-type': 'application/json; charset=utf-8' });
          return res.end(JSON.stringify({ ok: false, error: 'actor-required' }));
        }
        for (let depot of depots) {
          let file = join(claimsDirFor(depot.dir), `${actor}.json`);
          let existed = await stat(file).then(() => true).catch(() => false);
          if (!existed) continue;
          // Leave `<actor>.json.until` so `deck claim --status` can still
          // tell revoked from expired — same as `deck claim --clear`.
          await rm(file, { force: true });
          res.writeHead(200, {
            'content-type': 'application/json; charset=utf-8',
            'cache-control': 'no-store',
          });
          return res.end(JSON.stringify({ ok: true, actor, depot: depot.name }));
        }
        res.writeHead(404, { 'content-type': 'application/json; charset=utf-8' });
        return res.end(JSON.stringify({ ok: false, error: 'not-found' }));
      })();
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
      // THE QUERY STRING SURVIVES THE REDIRECT.
      //
      // These four routes are aliases, and an alias that silently drops the
      // query is an alias that only works for the front page. It broke the
      // one link that matters most — `/browse?at=…&vs=…` from a /track row —
      // by landing you on the depot index with no hint that you had asked for
      // a diff. It would break the lens tabs the same way the moment they
      // start carrying a focused address between apps.
      // `with` belongs to the framed page, not to app/run itself. Keep it as
      // UI state until Run constructs the frame URL.
      if (app.route === 'run' && requested.searchParams.has('with')) {
        let values = requested.searchParams.getAll('with');
        requested.searchParams.delete('with');
        for (let value of values) requested.searchParams.append('sub', value);
      }
      return built.has(app.route)
        ? redirect(res, `/${hub.name}/${app.deck}/${requested.search}`)
        : notBuilt(res, app);
    }
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end(`no route for ${path}\n`);
  },
});

// One socket, many truthful depot roots. The Host header selects the logical
// `site` mount used by a running demo; the ordinary localhost host selects the
// Hub and its browse-name mounts. Inner Deck servers never listen themselves.
const gateway = createServer((req, res) => {
  let hostname;
  try {
    hostname = new URL(`http://${req.headers.host ?? 'localhost'}`).hostname;
  } catch {
    hostname = 'localhost';
  }
  let suffix = '.localhost';
  if (hostname.endsWith(suffix)) {
    let name = hostname.slice(0, -suffix.length);
    let target = virtualServers.get(name);
    if (!target) {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      res.end(`no demo named ${name}\n`);
      return;
    }
    target.emit('request', req, res);
    return;
  }
  server.emit('request', req, res);
});

// The Hub edits itself. Every save under `apps/hub/depot` auto-publishes an
// immutable prerelease, seals it if a history backend attached, and pushes a
// change event that reloads any open page. Building the tool with the tool is
// the only way to find out what using it is actually like.
let watcher = watchDepot({
  depot: hub,
  onLiveChange: (event) => {
    server.liveBus.emit(event);
  },
  onPublish: (event) =>
    console.log(
      `   saved → ${event.name}@${event.version}` +
        (event.sealChangeId ? ` sealed ${event.sealChangeId.slice(0, 12)}` : ''),
    ),
  onError: (error) => console.error(`   watch: ${error}`),
});
watcher.rescan();

// CLI and agents mutate Repository refs beside the running Hub. Poll only the
// tiny mutable heads and emit the same live event as a Hub action, so Browse
// and Review never need to know which client performed the operation.
let repositoryFingerprint = await repositoryService.fingerprint();
let repositoryPollBusy = false;
setInterval(async () => {
  if (repositoryPollBusy) return;
  repositoryPollBusy = true;
  try {
    let next = await repositoryService.fingerprint();
    if (next === repositoryFingerprint) return;
    repositoryFingerprint = next;
    server.liveBus.emit({ name: 'repositories', treeHash: String(Date.now()) });
  } catch (error) {
    console.error(`   repository watch: ${error.message ?? error}`);
  } finally {
    repositoryPollBusy = false;
  }
}, 1000).unref();

// The Hub's own port is NOT ephemeral — you have to be able to type it — so
// this is the one listener that can still collide, and it says so in words
// instead of a stack trace. An already-running Hub is the likeliest cause and
// the likeliest thing to be mistaken for a broken one.
gateway.once('error', (error) => {
  if (error.code !== 'EADDRINUSE') throw error;
  console.error(`\n   Port ${PORT} is taken — something is already listening.`);
  console.error(`   If it is an older Hub, stop it first; a stale one serves`);
  console.error(`   stale Hub code and every demo frame may come up blank.\n`);
  console.error(`      lsof -ti:${PORT} | xargs kill`);
  console.error(`      PORT=8789 node apps/hub/hub.mjs   # or just use another\n`);
  process.exit(1);
});

gateway.listen(PORT, () => {
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
    console.log(
      `      ${depot.name.padEnd(22)} runs at http://${depot.name}.localhost:${PORT}`,
    );
  }
  console.log(
    '\n   One listener. Each demo is READ at /<name>/… and RUN on its virtual host,',
  );
  console.log(
    '   because every one was sealed as `site` and absolute pins keep that host.\n',
  );
});

for (let signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    watcher.stop?.();
    for (let demoWatcher of demoWatchers) demoWatcher.stop?.();
    gateway.close();
    process.exit(0);
  });
}
