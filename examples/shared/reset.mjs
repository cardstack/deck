// Putting a demo back to its starting state.
//
// READ THIS BEFORE COPYING IT. Wiping a store and deleting seals is a
// DEMO-ONLY operation and must never become an ordinary one. In production
// there is no reset: going back is `deck restore`, which replays a sealed
// state forward as ordinary writes, so the state you left is itself sealed
// first and history only ever grows. That is the whole promise — you cannot
// lose work — and it is only true because nothing routinely deletes.
//
// A demo is the one case where the opposite is required. It has to produce
// the same transcript on the tenth run as on the first, which means it has
// to start from a fixed state rather than from wherever the ninth run left
// off. So the reset is explicit, it names exactly what it destroys, and it
// lives here rather than in the CLI, where somebody would eventually reach
// for it on a Tuesday.

import { rm, writeFile } from 'node:fs/promises';
import { mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { storeDirFor } from '@deck/server/depot';

/**
 * @param {object} options
 * @param {string} options.depotDir            the depot to reset
 * @param {string[]} [options.output]          directories the demo WRITES —
 *   fork scopes, generated decks — relative to the depot. Deleted whole.
 * @param {Record<string,string>} [options.pristine]  files the demo edits in
 *   place, mapped to the exact content run N+1 must start from. Checked in
 *   with these same bytes, so a finished run leaves the tree clean.
 */
export async function resetDemoDepot({ depotDir, output = [], pristine = {} }) {
  // The store: every version this demo published. Rebuilt from scratch.
  await rm(storeDirFor(depotDir), { recursive: true, force: true });
  // The seals. A demo that kept them would show a different history every
  // run, and the history IS what several of these demos are showing. jj
  // colocates a backing `.git` beside `.jj`, so both go.
  await rm(join(depotDir, '.jj'), { recursive: true, force: true });
  await rm(join(depotDir, '.git'), { recursive: true, force: true });
  for (let relative of output) {
    await rm(join(depotDir, relative), { recursive: true, force: true });
  }
  for (let [relative, content] of Object.entries(pristine)) {
    let path = join(depotDir, relative);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, content);
  }
  await mkdir(storeDirFor(depotDir), { recursive: true });
}
