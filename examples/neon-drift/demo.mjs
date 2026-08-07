#!/usr/bin/env node
// Neon Drift — a vibe-coding session that exercises Deck end to end:
//
//   1. vendor a real CDN library (simplex-noise) into YOUR store
//   2. watch three local packages (ink, swarm, neon-drift app)
//   3. serve /live/* for instant edits + auto-publish -dev.N seals
//   4. compose them in the browser via an import map — no bundler
//
//   pnpm --filter @deck/example-neon-drift demo
//   open http://localhost:8788/live/neon-drift/index.html
import { mkdir, readFile, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { IMPORT_MAP_PATH, parsePackages } from '@deck/core/import-map';
import { pack, packFromDir, peekPacklist } from '@deck/core/pack';
import {
  nextDevVersion,
  publishToStore,
  readStoreMeta,
} from '@deck/core/store';
import { vendorFromCdn, vendorImportMap } from '@deck/core/vendor';
import { createDeckServer } from '@deck/server/server';
import { watchAndPublish } from '@deck/server/watcher';

const here = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT ?? 8788);
const storeDir = join(here, '.store');
const inkDir = join(here, 'packages', 'ink');
const swarmDir = join(here, 'packages', 'swarm');
const fireworksDir = join(here, 'packages', 'fireworks');
const waterDir = join(here, 'packages', 'water');
const appDir = join(here, 'app');

await rm(storeDir, { recursive: true, force: true });
await mkdir(storeDir, { recursive: true });

console.log('1) vendor simplex-noise from esm.sh (hermetic, once)…');
let vendored = await vendorFromCdn({
  entryUrl: 'https://esm.sh/simplex-noise@4.0.1',
});
let noisePack = pack([
  {
    path: 'importmap.json',
    bytes: vendorImportMap(
      'simplex-noise',
      '4.0.1',
      vendored.entryPath,
      'https://esm.sh/simplex-noise@4.0.1',
    ),
  },
  ...vendored.files,
]);
let noiseList = peekPacklist(noisePack);
await publishToStore(storeDir, 'simplex-noise', '4.0.1', noisePack, {
  tag: 'latest',
});
console.log(
  `   sealed ${vendored.modules.length} modules → simplex-noise@4.0.1`,
);
console.log(`   treeHash ${noiseList.treeHash.hash}`);

const watches = [
  { dir: inkDir, name: 'ink' },
  { dir: swarmDir, name: 'swarm' },
  { dir: fireworksDir, name: 'fireworks' },
  { dir: waterDir, name: 'water' },
  { dir: appDir, name: 'neon-drift' },
];

console.log('2) seal current trees, then watch for edits…');
// The watcher only reacts to filesystem events — it does not publish the
// tree that already exists when it starts. Seed once so /@name@dev and
// /_packages/<name> work before the first keystroke.
for (let { dir, name } of watches) {
  let map = parsePackages(await readFile(join(dir, IMPORT_MAP_PATH), 'utf8'));
  let base = map?.[name]?.version ?? '0.0.0';
  let version = nextDevVersion(await readStoreMeta(storeDir, name), base);
  let bytes = await packFromDir(dir);
  let { treeHash } = await publishToStore(storeDir, name, version, bytes, {
    tag: 'dev',
  });
  console.log(`   seeded ${name}@${version} (${treeHash.slice(0, 12)})`);
}

let live = Object.fromEntries(watches.map((w) => [w.name, w.dir]));
let server = createDeckServer({ storeDir, live });
for (let { dir, name } of watches) {
  watchAndPublish({
    dir,
    name,
    storeDir,
    onLiveChange: (event) => server.liveBus.emit(event),
    onPublish: ({ version, treeHash }) =>
      console.log(`   saved → ${name}@${version} (${treeHash.slice(0, 12)})`),
    onError: (error) => console.error(`   watch ${name}:`, error),
  });
}
server.listen(PORT, () => {
  let url = `http://localhost:${PORT}/live/neon-drift/index.html`;
  console.log(`
3) deck server up

      ${url}

  What you're seeing:
    • three blocks: Drift (/live/swarm) · Fireworks · Water
    • Deck browser: http://localhost:${PORT}/  (packages · files · versions)
    • /live/* packages + HMR via /_live/hmr.js
    • /@simplex-noise@4.0.1 hermetic vendored noise

  Edit any package under packages/ — the page hot-reloads.
`);
});
