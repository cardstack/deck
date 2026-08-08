import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { IMPORT_MAP_PATH } from './import-map.ts';

// Finding the decks in a realm. The rule is the layout itself: a directory
// two levels down holding an importmap.json IS a deck, addressed at
// `/<realm>/<publisher>/<package>/`. Nothing registers; nothing is
// configured.

export interface DeckRef {
  publisher: string;
  package: string;
  // `<publisher>/<package>` — the store name and the log path both use it.
  name: string;
  dir: string;
}

const SEGMENT = /^[a-z0-9][a-z0-9-]{0,63}$/;

export async function discoverDecks(realmDir: string): Promise<DeckRef[]> {
  let decks: DeckRef[] = [];
  for (let publisher of await directoriesIn(realmDir)) {
    for (let name of await directoriesIn(join(realmDir, publisher))) {
      let dir = join(realmDir, publisher, name);
      if (!(await isFile(join(dir, IMPORT_MAP_PATH)))) {
        continue;
      }
      decks.push({
        publisher,
        package: name,
        name: `${publisher}/${name}`,
        dir,
      });
    }
  }
  return decks.sort((a, b) => (a.name < b.name ? -1 : 1));
}

async function directoriesIn(dir: string): Promise<string[]> {
  try {
    return (await readdir(dir, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory() && SEGMENT.test(entry.name))
      .map((entry) => entry.name)
      .sort();
  } catch {
    return [];
  }
}

async function isFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}
