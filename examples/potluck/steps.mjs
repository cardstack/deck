#!/usr/bin/env node
// Apply Stages 2–10 under a running watcher (or seal via history if none).
// Stage 1 is written by demo.mjs.
import { writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHistory } from '@cardstack/deck-history/create';
import { STAGE } from './stages.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const depot = join(here, 'depot');
const formDir = join(depot, 'app', 'form');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const attachment = await createHistory({
  dir: depot,
  kind: 'jj',
  onError: (error) => console.error(error),
});

async function writeStage(stage, index) {
  await writeFile(join(formDir, 'index.html'), stage.html);
  await sleep(200);
  await writeFile(join(formDir, 'form.css'), stage.css);
  await sleep(200);
  await writeFile(join(formDir, 'form.js'), stage.js);
  await sleep(200);
  await writeFile(join(formDir, 'importmap.json'), stage.importmap);
  // Explicit seal so each Stage is one Timeline notch even if the watcher
  // coalesces bursts — message names the intention.
  if (attachment.backend) {
    await sleep(500);
    let id = await attachment.backend.seal(depot, stage.label);
    console.log(`${String(index + 1).padStart(2, '0')}  ${id?.slice(0, 12) ?? 'clean'}  ${stage.label}`);
  } else {
    await sleep(900);
    console.log(`${String(index + 1).padStart(2, '0')}  (no history)  ${stage.label}`);
  }
}

console.log(`writing ${STAGE.length} stages into ${formDir}`);
for (let i = 0; i < STAGE.length; i++) {
  await writeStage(STAGE[i], i);
}
attachment.backend?.close();
console.log('done — open /run → potluck/app/form');
