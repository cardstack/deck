import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

// The canonical fixture realm.
//
// Every implementation builds THIS tree and must arrive at the same
// treeHash. That is what makes L1 checkable across implementations rather
// than only within one: a golden hash is the only way to catch a hash
// function that is self-consistent and wrong.
//
// The content is chosen to exercise the corners that have actually bitten:
// a nested path, a UTF-8 filename that sorts differently by code point than
// by locale, an empty file, a file with no trailing newline, and CRLF.

export const FIXTURE_REALM = 'conformance';
export const FIXTURE_PUBLISHER = 'deck';
export const FIXTURE_PACKAGE = 'fixture';
export const FIXTURE_VERSION = '1.0.0';

export interface FixtureFile {
  path: string;
  bytes: Buffer;
}

export function fixtureFiles(): FixtureFile[] {
  return [
    {
      path: 'importmap.json',
      bytes: Buffer.from(
        JSON.stringify(
          {
            imports: {},
            deck: {
              packages: {
                [FIXTURE_PACKAGE]: {
                  version: FIXTURE_VERSION,
                  entry: '$REALM/index.js',
                  exports: { './alias.js': '$REALM/nested/deep.js' },
                },
              },
            },
          },
          null,
          2,
        ) + '\n',
        'utf8',
      ),
    },
    {
      path: 'index.js',
      bytes: Buffer.from(
        "import './nested/deep.js';\nexport const marker = 'deck-conformance-v1';\n",
        'utf8',
      ),
    },
    { path: 'nested/deep.js', bytes: Buffer.from('export const deep = 1;\n', 'utf8') },
    // No trailing newline: a hash that normalises line endings fails here.
    { path: 'no-newline.txt', bytes: Buffer.from('tail', 'utf8') },
    // CRLF must survive as CRLF.
    { path: 'crlf.txt', bytes: Buffer.from('a\r\nb\r\n', 'utf8') },
    // Empty file: present in the tree, contributes its path and zero bytes.
    { path: 'empty.txt', bytes: Buffer.alloc(0) },
    // Big enough to cross the compression threshold, so a conformance run
    // actually exercises content negotiation rather than skipping past it.
    {
      path: 'bulky.js',
      bytes: Buffer.from(
        'export const filler = [\n' +
          Array.from(
            { length: 200 },
            (_ignored, index) => `  'row ${index} of highly compressible filler',`,
          ).join('\n') +
          '\n];\n',
        'utf8',
      ),
    },
    // Sorting is by UTF-8 bytes, not by locale: "z" < "ä" byte-wise.
    { path: 'z-ascii.txt', bytes: Buffer.from('z\n', 'utf8') },
    { path: 'ä-utf8.txt', bytes: Buffer.from('a-umlaut\n', 'utf8') },
  ];
}

// The golden hash of the tree above under tree-hash-v1. An implementation
// that produces a different value is not compatible, however internally
// consistent it is.
//
// Regenerate ONLY when the fixture content itself changes, never to make a
// failing implementation pass:
//   node -e "import('@deck/core/tree-hash').then(async m => …)"
export const FIXTURE_TREE_HASH =
  'ae0aeb21336ab6539aa8cba256135d752001dc52f5180a5d9047d41eb0a0e42c';

export async function writeFixtureRealm(root: string): Promise<string> {
  let realmDir = join(root, FIXTURE_REALM);
  let deckDir = join(realmDir, FIXTURE_PUBLISHER, FIXTURE_PACKAGE);
  await mkdir(join(deckDir, 'nested'), { recursive: true });
  for (let file of fixtureFiles()) {
    await writeFile(join(deckDir, ...file.path.split('/')), file.bytes);
  }
  return realmDir;
}
