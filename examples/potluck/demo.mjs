#!/usr/bin/env node
// Potluck RSVP form — fields from the field-library shelf + ProseMirror notes.
// Sealed packs are copied from sibling demos (same treeHashes), then the live
// app evolves across Timeline Steps via `pnpm steps` under the watcher.
//
//   pnpm --filter @deck/example-potluck demo
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { publishToStore, readStoredPack, readStoreMeta } from '@deck/core/store';
import { storeDirFor } from '@deck/server/depot';
import {
  createDemoServer,
  demoOrigin,
  liveNotes,
  openDemoDepot,
  serveLive,
} from '../shared/depot.mjs';
import { publishShared } from '../shared/publish.mjs';
import { STAGE } from './stages.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT ?? 8802);
const depotDir = join(here, 'depot');
const storeDir = storeDirFor(depotDir);
const formDir = join(depotDir, 'app', 'form');

const fieldStore = storeDirFor(join(here, '..', 'field-library', 'depot'));
const pmStore = storeDirFor(join(here, '..', 'prosemirror', 'depot'));

/** Copy every published version of a package into this depot's store. */
async function copyPackage(fromStore, name) {
  let meta = await readStoreMeta(fromStore, name);
  if (!meta) throw new Error(`missing ${name} in ${fromStore}`);
  for (let version of Object.keys(meta.versions)) {
    let packBytes = await readStoredPack(fromStore, name, version);
    if (!packBytes) throw new Error(`no pack ${name}@${version}`);
    let tag = meta.tags?.latest === version ? 'latest' : undefined;
    try {
      await publishToStore(storeDir, name, version, packBytes, { tag });
      console.log(`   copied ${name}@${version}`);
    } catch (error) {
      if (!String(error.message).includes('already')) throw error;
    }
  }
}

await rm(storeDir, { recursive: true, force: true });
await mkdir(formDir, { recursive: true });

console.log('\n  POTLUCK — form that grows across Steps\n');
await publishShared(storeDir);

console.log('copying field shelf + fields');
for (let name of [
  'lib/zod',
  'lib/date-fns',
  'lib/nanoid',
  'lib/luxon',
  'fields/due-date',
  'fields/handle',
  'fields/meeting-slot',
]) {
  await copyPackage(fieldStore, name);
}

console.log('copying ProseMirror shelf');
for (let name of [
  'lib/prosemirror-model',
  'lib/prosemirror-state',
  'lib/prosemirror-view',
  'lib/prosemirror-keymap',
  'lib/prosemirror-commands',
  'lib/prosemirror-history',
  'lib/prosemirror-schema-basic',
  'lib/prosemirror-transform',
  'lib/orderedmap',
  'lib/w3c-keyname',
  'lib/rope-sequence',
]) {
  await copyPackage(pmStore, name);
}

// Stage 1 on disk before the watcher starts.
let stage1 = STAGE[0];
await writeFile(join(formDir, 'index.html'), stage1.html);
await writeFile(join(formDir, 'form.css'), stage1.css);
await writeFile(join(formDir, 'form.js'), stage1.js);
await writeFile(join(formDir, 'importmap.json'), stage1.importmap);

const depot = await openDemoDepot({ name: 'site', dir: depotDir });
const server = createDemoServer({ depots: [depot] });
serveLive({ depot, server });
server.listen(PORT, () => {
  let origin = demoOrigin(PORT);
  console.log(`\n  ${origin}/site/app/form/index.html`);
  console.log('  then: pnpm --filter @deck/example-potluck steps\n');
  for (let line of liveNotes({ depot, port: PORT, origin })) console.log(line);
});
