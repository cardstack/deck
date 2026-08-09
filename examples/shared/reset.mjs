// Putting a demo back to its starting state — OPT-IN ONLY.
//
// READ THIS BEFORE COPYING IT. Wiping a store and deleting seals is a
// DEMO-ONLY operation and must never become an ordinary one. In production
// there is no reset: going back is `deck restore`, which replays a sealed
// state forward as ordinary writes, so the state you left is itself sealed
// first and history only ever grows. That is the whole promise — you cannot
// lose work — and it is only true because nothing routinely deletes.
//
// DEFAULT FOR EVERY DEMO: do not call this. Re-run → serve what is already
// there. `RESET=1` is the only switch that rebuilds a transcript from
// scratch. Even then Notes and Claims are never deleted:
//
//   Notes   <depot>/<actor>/notes/     content in the tree
//   Claims  <depot>/.deck/claims/      intent, outside the hash
//
// Timeline seals (`.jj`) go with RESET=1 because several demos ARE the
// history transcript; set RESET_HISTORY=0 to keep seals while refreshing
// the store.

import { rename, rm, writeFile, mkdir, access } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { readStoreMeta } from '@deck/core/store';
import { storeDirFor } from '@deck/server/depot';

/** True only when the operator asked for a destructive reseed. */
export function wantDemoReset() {
  return process.env.RESET === '1';
}

/**
 * Has this package@version already been published into the depot store?
 * Used to skip rebuilds on ordinary re-runs.
 */
export async function storeHasVersion(storeDir, name, version) {
  let meta = await readStoreMeta(storeDir, name);
  return Boolean(meta?.versions?.[version]);
}

/**
 * Remove a directory but keep `<dir>/notes/` if present.
 * Notes are commentary about trees — wiping a fork scope must not erase them.
 */
async function rmKeepingNotes(dir) {
  let notes = join(dir, 'notes');
  let saved;
  try {
    await access(notes);
    saved = `${notes}.deck-reset-save`;
    await rm(saved, { recursive: true, force: true });
    await rename(notes, saved);
  } catch {
    // no notes to keep
  }
  await rm(dir, { recursive: true, force: true });
  if (saved) {
    await mkdir(dir, { recursive: true });
    await rename(saved, notes);
  }
}

/**
 * @param {object} options
 * @param {string} options.depotDir
 * @param {string[]} [options.output]   demo-written dirs relative to depot
 * @param {Record<string,string>} [options.pristine]
 * @param {boolean} [options.history]   wipe `.jj` (default: true under RESET)
 */
export async function resetDemoDepot({
  depotDir,
  output = [],
  pristine = {},
  history = process.env.RESET_HISTORY !== '0',
}) {
  if (!wantDemoReset()) {
    throw new Error(
      'resetDemoDepot() refused — set RESET=1 to wipe a demo store. ' +
        'Ordinary re-runs must serve what is already there.',
    );
  }

  // Store only under .deck/ — never .deck/claims/.
  await rm(storeDirFor(depotDir), { recursive: true, force: true });

  if (history) {
    await rm(join(depotDir, '.jj'), { recursive: true, force: true });
    await rm(join(depotDir, '.git'), { recursive: true, force: true });
  }

  for (let relative of output) {
    // Preserve Notes inside wiped fork/agent scopes.
    await rmKeepingNotes(join(depotDir, relative));
  }

  for (let [relative, content] of Object.entries(pristine)) {
    let path = join(depotDir, relative);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, content);
  }
  await mkdir(storeDirFor(depotDir), { recursive: true });
  console.log(
    '   RESET=1 — wiped .deck/store' +
      (history ? ' and Timeline seals' : '') +
      '; Notes and Claims kept',
  );
}

/**
 * Run `build` only when the store lacks `probe`, or when RESET=1.
 * On RESET, call `reset` first (which must itself require wantDemoReset).
 *
 * @param {object} options
 * @param {string} options.storeDir
 * @param {{ name: string, version: string }} options.probe
 * @param {() => Promise<void>} [options.reset]
 * @param {() => Promise<void>} options.build
 * @param {string} [options.label]
 */
export async function seedOrSkip({ storeDir, probe, reset, build, label }) {
  await mkdir(storeDir, { recursive: true });
  let seeded = await storeHasVersion(storeDir, probe.name, probe.version);

  if (wantDemoReset()) {
    if (reset) await reset();
    else await rm(storeDir, { recursive: true, force: true });
    await mkdir(storeDir, { recursive: true });
    await build();
    return 'rebuilt';
  }

  if (seeded) {
    console.log(
      `   ${label ?? probe.name}@${probe.version} already in store — ` +
        `skipping rebuild (RESET=1 to rebuild from scratch)`,
    );
    return 'skipped';
  }

  await build();
  return 'seeded';
}
