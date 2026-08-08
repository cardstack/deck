#!/usr/bin/env node
// Fork an app — take almost all of somebody else's library, change the two
// things you disagree with, and run YOUR version.
//
// The library is Leaflet, which publishes real per-file ESM: 85 modules,
// nothing pointing outside the package. Vendoring it gives you the module
// boundary intact, so "change one file" means changing one file — not
// patching a 140 KB bundle or maintaining a downstream build.
//
// What this demonstrates, end to end:
//
//   L6  hermetic     nothing on the page reaches the live web at runtime.
//                    No tile server: the maps draw vector layers, so the
//                    only bytes involved are ones you sealed.
//   L8  provenance   the vendored deck records registry, integrity, and
//                    the repo+commit npm declared, checkable blob by blob.
//   L3  no copies    the fork changes ONE file out of 85. The store holds
//                    one copy of the other 84 — printed below, measured,
//                    not asserted.
//   L1  identity     a different tree is a different treeHash, so the two
//                    versions can be served side by side and neither can
//                    be mistaken for the other.
//
//   pnpm --filter @deck/example-fork-an-app demo
//   open http://localhost:8791/
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pack, unpack } from '@deck/core/pack';
import { publishToStore, inspectStore } from '@deck/core/store';
import { vendorFromNpmSource } from '@deck/core/vendor-npm';
import { createDeckServer } from '@deck/server/server';
import { storeDirFor } from '@deck/server/realm';
import { lockAndWrite, publishShared } from '../shared/publish.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT ?? 8791);
const REALM = 'site';
const realmDir = join(here, 'realm');
const storeDir = storeDirFor(realmDir);
const SPEC = 'leaflet@1.9.4';
const VERSION = '1.9.4';
const FORK_VERSION = '1.9.4-mine.0';

await rm(storeDir, { recursive: true, force: true });
await mkdir(storeDir, { recursive: true });

console.log('\n  FORK AN APP — take all of it, change the part you disagree with\n');

// ---------------------------------------------------------------------------
// 1. Vendor from npm SOURCE. Not a CDN bundle: the module tree npm published.
// ---------------------------------------------------------------------------
console.log(`1) vendoring ${SPEC} from npm source…`);
let vendored = await vendorFromNpmSource({
  spec: SPEC,
  // The cooldown gate is off here only because a demo should not fail on the
  // day someone runs it. A realm sets a real minimumReleaseAge; see L11.
  policy: { minimumReleaseAge: 0 },
});
console.log(`   ${vendored.modules.length} modules, ${vendored.externals.length} externals`);
console.log(`   entry ${vendored.entryPath}`);
console.log(`   from  ${vendored.vendoredFrom.registry} · ${vendored.vendoredFrom.integrity?.slice(0, 24)}…`);
if (vendored.vendoredFrom.repo) {
  console.log(`   repo  ${vendored.vendoredFrom.repo}${vendored.vendoredFrom.commit ? ` @ ${vendored.vendoredFrom.commit.slice(0, 12)}` : ''}`);
}

let mapBytes = Buffer.from(
  JSON.stringify(
    {
      deck: {
        packages: {
          leaflet: {
            version: VERSION,
            entry: `$REALM/${vendored.entryPath}`,
            vendoredFrom: vendored.vendoredFrom,
          },
        },
      },
    },
    null,
    2,
  ) + '\n',
  'utf8',
);
// The module walk follows imports, and a stylesheet is not imported by any
// of them — but a library's CSS is unambiguously part of what you vendored,
// and leaving it behind would mean reaching for a CDN to get it back. So it
// is carried explicitly, from the same verified tarball.
const CSS = 'dist/leaflet.css';
let css = vendored.pkg.files.get(CSS);
if (!css) {
  throw new Error(`the demo expected ${CSS} in the ${SPEC} tarball`);
}
let upstream = pack([
  { path: 'importmap.json', bytes: mapBytes },
  { path: CSS, bytes: css },
  ...vendored.files,
]);
let upstreamHash = (await publishToStore(storeDir, 'lib/leaflet', VERSION, upstream, { tag: 'latest' })).treeHash;
console.log(`   sealed lib/leaflet@${VERSION} · ${upstreamHash.slice(0, 12)}…`);

// ---------------------------------------------------------------------------
// 2. Fork it, and change exactly one file.
//
// Leaflet's zoom control renders its own glyphs and its own title text. It
// is a real file with real behaviour — the point is that after vendoring,
// changing it is an ordinary edit, because the module boundary survived.
// ---------------------------------------------------------------------------
const TARGET = 'src/control/Control.Zoom.js';
let opened = unpack(upstream);
let original = opened.files.get(TARGET);
if (!original) {
  throw new Error(`the demo expected ${TARGET} in the vendored tree`);
}
let patched = original
  .toString('utf8')
  .replace(/zoomInText:\s*'[^']*'/, "zoomInText: '＋'")
  .replace(/zoomOutText:\s*'[^']*'/, "zoomOutText: '－'")
  .replace(/zoomInTitle:\s*'[^']*'/, "zoomInTitle: 'Closer (my fork)'")
  .replace(/zoomOutTitle:\s*'[^']*'/, "zoomOutTitle: 'Further (my fork)'");
if (patched === original.toString('utf8')) {
  throw new Error(`the demo failed to patch ${TARGET} — upstream shape changed`);
}

let forkFiles = [...opened.files.entries()].map(([path, bytes]) =>
  path === TARGET
    ? { path, bytes: Buffer.from(patched, 'utf8') }
    : path === 'importmap.json'
      ? {
          path,
          bytes: Buffer.from(
            JSON.stringify(
              {
                deck: {
                  packages: {
                    leaflet: {
                      version: FORK_VERSION,
                      entry: `$REALM/${vendored.entryPath}`,
                      // Provenance survives the fork: this is still Leaflet,
                      // and it still says where it came from. What changed is
                      // recorded beside it, not instead of it.
                      vendoredFrom: vendored.vendoredFrom,
                      forkedFrom: { deck: 'lib/leaflet', version: VERSION, treeHash: upstreamHash },
                      changed: [TARGET],
                    },
                  },
                },
              },
              null,
              2,
            ) + '\n',
            'utf8',
          ),
        }
      : { path, bytes },
);
let forkPack = pack(forkFiles);
let forkHash = (await publishToStore(storeDir, 'me/leaflet', FORK_VERSION, forkPack, { tag: 'mine' })).treeHash;
console.log(`\n2) forked → me/leaflet@${FORK_VERSION} · ${forkHash.slice(0, 12)}…`);
console.log(`   changed ${TARGET}`);
console.log(`   …and importmap.json, which now records the fork's lineage.`);
console.log(`   That second edit is why the fork inherits no endorsements:`);
console.log(`   it is a different tree because it ANNOUNCES a different`);
console.log(`   lineage, and a signature about upstream's bytes should not`);
console.log(`   travel to something claiming to be someone else (L10).`);

// ---------------------------------------------------------------------------
// 3. What the fork cost. This is the number worth reading.
// ---------------------------------------------------------------------------
let report = await inspectStore(storeDir);
let files = opened.files.size;
console.log(`\n3) the store now holds two ${files}-file packages`);
console.log(`   objects: ${report.objects}   (two full copies would be ${files * 2})`);
console.log(`   bytes:   ${report.bytes.toLocaleString()}`);
console.log(`   the fork cost ${report.objects - files} new object${report.objects - files === 1 ? '' : 's'} — the`);
console.log(`   other ${files - 1} are the same bytes, so they are stored once.`);

// ---------------------------------------------------------------------------
// 4. Serve both. The page mounts two maps from two different decks.
// ---------------------------------------------------------------------------

// The shared `ui/pills` deck, published into THIS realm's store from
// examples/shared. Five demos, five stores, one source tree — and because
// identity is the hash of the tree, the treeHash below is the same in all
// five. Then the viewer's decklist is locked, so the pins that resolve
// `ui/pills` are in the tree where you can read them.
let [pills] = await publishShared(storeDir);
let viewerLock = await lockAndWrite({
  realmDir,
  realmName: REALM,
  storeDir,
  deckDir: join(realmDir, 'app', 'viewer'),
});
console.log(`\n   shared: ${pills.name}@${pills.version} \u00b7 ${pills.treeHash.slice(0, 12)}\u2026 (same tree in every demo)`);
if (viewerLock.changed) {
  console.log(`   note: the checked-in lock was stale and has been rewritten`);
}

await writeFile(
  join(realmDir, 'app', 'viewer', 'build.json'),
  JSON.stringify(
    {
      realm: REALM,
      entry: vendored.entryPath,
      changed: TARGET,
      modules: opened.files.size - 1,
      store: { objects: report.objects, bytes: report.bytes, wouldBe: files * 2 },
      upstream: { deck: 'lib/leaflet', version: VERSION, hash: upstreamHash },
      fork: { deck: 'me/leaflet', version: FORK_VERSION, hash: forkHash },
      provenance: {
        registry: vendored.vendoredFrom.registry,
        name: vendored.vendoredFrom.name,
        version: vendored.vendoredFrom.version,
        integrity: vendored.vendoredFrom.integrity ?? null,
        repo: vendored.vendoredFrom.repo ?? null,
        commit: vendored.vendoredFrom.commit ?? null,
      },
    },
    null,
    2,
  ) + '\n',
);

let server = createDeckServer({
  realms: [{ name: REALM, dir: realmDir, storeDir }],
  fallback: (req, res) => {
    res.writeHead(302, { location: `/${REALM}/app/viewer/index.html` });
    res.end();
  },
});
server.listen(PORT, () => {
  console.log(`\n4) serving both versions side by side\n`);
  console.log(`      http://localhost:${PORT}/\n`);
  console.log(`      /${REALM}/lib/leaflet@${VERSION}/${vendored.entryPath}`);
  console.log(`      /${REALM}/me/leaflet@${FORK_VERSION}/${vendored.entryPath}`);
  console.log(`\n   Both maps draw vector layers only — no tile server, so`);
  console.log(`   nothing on the page reaches the network at runtime.\n`);
});
