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
import { IMPORT_MAP_PATH } from '@cardstack/deck/import-map';
import { lockDeck } from '@cardstack/deck/lock';
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
 * Resolve a deck's declared ranges into pins and write them into its own
 * importmap.json — `deck lock`, in the tree, where you can read it.
 *
 * The pins are checked in, and every version these demos depend on is exact,
 * so a clean run must produce no change. `changed` coming back true means
 * something really did resolve differently, which is worth saying out loud
 * rather than quietly relocking.
 */
export async function lockAndWrite(options) {
  let locked = await lockDeck(options);
  await writeFile(join(options.deckDir, IMPORT_MAP_PATH), locked.text);
  return locked;
}
