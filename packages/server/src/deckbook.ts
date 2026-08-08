import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Serve the teaching deckbook from the monorepo root when present.
// Candidates cover: packages/server/src → ../../../deckbook.html,
// and cwd when someone runs from the repo root.

const HERE = dirname(fileURLToPath(import.meta.url));
const CANDIDATES = [
  join(HERE, '../../../deckbook.html'),
  join(process.cwd(), 'deckbook.html'),
];

let cached: { path: string; html: string } | undefined;

export async function loadDeckbookHtml(): Promise<string | undefined> {
  if (cached) {
    try {
      let html = await readFile(cached.path, 'utf8');
      cached = { path: cached.path, html };
      return html;
    } catch {
      cached = undefined;
    }
  }
  for (let path of CANDIDATES) {
    try {
      let html = await readFile(path, 'utf8');
      cached = { path, html };
      return html;
    } catch {
      // try next
    }
  }
  return undefined;
}

export const DECKBOOK_PATHS = new Set([
  '/deckbook',
  '/deckbook/',
  '/deckbook.html',
]);
