#!/usr/bin/env node
// Potluck RSVP form — fields from the field-library shelf + ProseMirror notes.
//
//   pnpm --filter @deck/example-potluck demo
//   pnpm --filter @deck/example-potluck steps
//
// DEFAULT IS ADDITIVE. Re-running this must not delete Notes, Claims, Timeline
// seals, or published versions. `RESET=1` is the only path that wipes the
// store — and even then it leaves `<actor>/notes/` and `.deck/claims/` alone.
import { access, mkdir, rm, writeFile } from 'node:fs/promises';
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
const RESET = process.env.RESET === '1';
const depotDir = join(here, 'depot');
const storeDir = storeDirFor(depotDir);
const formDir = join(depotDir, 'app', 'form');

const fieldStore = storeDirFor(join(here, '..', 'field-library', 'depot'));
const pmStore = storeDirFor(join(here, '..', 'prosemirror', 'depot'));

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

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

await mkdir(formDir, { recursive: true });
await mkdir(storeDir, { recursive: true });

if (RESET) {
  // Store only — never Notes (`<actor>/notes/`), never Claims (`.deck/claims/`),
  // never the Timeline (`.jj`). Those are durable; a demo reseed is not.
  console.log('\n  RESET=1 — wiping .deck/store only (notes/claims/seals kept)\n');
  await rm(storeDir, { recursive: true, force: true });
  await mkdir(storeDir, { recursive: true });
}

console.log('\n  POTLUCK — form that grows across Steps\n');
await publishShared(storeDir);

console.log('ensuring field shelf + fields');
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

console.log('ensuring ProseMirror shelf');
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

// Seed Stage 1 only when the live form is missing — never clobber a tree that
// already has Steps / Notes on top of it.
let formReady = await exists(join(formDir, 'index.html'));
if (!formReady || RESET) {
  let stage1 = STAGE[0];
  await writeFile(join(formDir, 'index.html'), stage1.html);
  await writeFile(join(formDir, 'form.css'), stage1.css);
  await writeFile(join(formDir, 'form.js'), stage1.js);
  await writeFile(join(formDir, 'importmap.json'), stage1.importmap);
  console.log(formReady ? '   reset live form to stage 1' : '   seeded stage 1');
} else {
  console.log('   live form present — left alone (run `pnpm steps` to evolve)');
}

const depot = await openDemoDepot({ name: 'site', dir: depotDir });
const server = createDemoServer({ depots: [depot] });
serveLive({ depot, server });
server.listen(PORT, () => {
  let origin = demoOrigin(PORT);
  console.log(`\n  ${origin}/site/app/form/index.html`);
  console.log('  evolve: pnpm --filter @deck/example-potluck steps');
  console.log('  wipe store only (keeps notes): RESET=1 pnpm --filter @deck/example-potluck demo\n');
  for (let line of liveNotes({ depot, port: PORT, origin })) console.log(line);
});
