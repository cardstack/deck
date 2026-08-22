// Publish the shared decks into a demo's own store.
//
// Every demo is a separate depot with a separate store — they share nothing
// at runtime, which is what makes each one's numbers its own. What they do
// share is a source tree, right here, published into each store from the same
// directory.
//
// The consequence is worth printing, and each demo does: identity is the hash
// of the file tree, so `ui/pills@1.0.0` has the SAME treeHash in all five
// stores. Five publishes, one tree, one name.
import { writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { lockDepot, DEPOT_LOCK_PATH } from '@cardstack/deck/lock';
import { packFromDir } from '@cardstack/deck/pack';
import { publishToStore } from '@cardstack/deck/store';

const here = dirname(fileURLToPath(import.meta.url));

export const SHARED = [{ name: 'ui/pills', dir: join(here, 'ui', 'pills'), version: '1.0.0' }];

export async function publishShared(storeDir) {
  let published = [];
  for (let deck of SHARED) {
    let { treeHash } = await publishToStore(
      storeDir,
      deck.name,
      deck.version,
      await packFromDir(deck.dir),
      { tag: 'latest' },
    );
    published.push({ name: deck.name, version: deck.version, treeHash });
  }
  return published;
}

/**
 * Resolve suggested ranges into the depot-root lock — `deck lock`.
 */
export async function lockAndWrite(options) {
  let locked = await lockDepot(options);
  await writeFile(join(options.depotDir, DEPOT_LOCK_PATH), locked.text);
  return locked;
}
