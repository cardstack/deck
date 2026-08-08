import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

// The canonical fixture depot.
//
// Every implementation builds THIS tree and must arrive at the same
// treeHash. That is what makes L1 checkable across implementations rather
// than only within one: a golden hash is the only way to catch a hash
// function that is self-consistent and wrong.
//
// The content is chosen to exercise the corners that have actually bitten:
// a nested path, a UTF-8 filename that sorts differently by code point than
// by locale, an empty file, a file with no trailing newline, and CRLF.

export const FIXTURE_DEPOT = 'conformance';
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
                  entry: '$DECK/index.js',
                  exports: { './alias.js': '$DECK/nested/deep.js' },
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
//
// Moved once, on purpose: the fixture's importmap.json used to write the tree
// root as `$REALM/` and now writes `$DECK/`. Different bytes, different tree,
// different hash — which is L1 doing its job, not a break in it. The previous
// value was ae0aeb21336ab653….
export const FIXTURE_TREE_HASH =
  'bdaf1081a608f0fd97d3734ffb1a63b85c8a9f2061dfbabc2132cf809b298b32';

// ---------------------------------------------------------------------------
// The scoped-graph fixture.
//
// Kept as its own decks rather than folded into the tree above, because that
// tree's hash is the golden value for L1 and must not move for a reason
// unrelated to L1.
//
// The shape is the one that matters and the one a single-deck fixture cannot
// express: `leaf` is reachable ONLY through a SCOPE on `dep`. A server that
// walks the graph with the global map alone still finds `app` and `dep` — so
// it looks like it is working — and silently never learns `leaf` exists.
// That is not a preload that is merely incomplete: because the walk never
// sees the module, the count it reports shrinks to match, and the response
// claims full coverage of a graph it half-walked.

export const GRAPH_PUBLISHER = 'deck';
export const GRAPH_APP = 'graph-app';
export const GRAPH_DEP = 'graph-dep';
export const GRAPH_LEAF = 'graph-leaf';
export const GRAPH_VERSION = '1.0.0';

// app.js, dep/index.js, leaf/index.js. Two of the three are reachable
// without scopes, which is exactly why the denominator is worth asserting.
export const GRAPH_MODULES = 3;

export function graphModuleUrl(depot: string, pkg: string, file: string) {
  return `/${depot}/${GRAPH_PUBLISHER}/${pkg}@${GRAPH_VERSION}/${file}`;
}

function manifest(pkg: string, entry: string, rest: Record<string, unknown> = {}) {
  return Buffer.from(
    JSON.stringify(
      {
        ...rest,
        deck: { packages: { [pkg]: { version: GRAPH_VERSION, entry: `$DECK/${entry}` } } },
      },
      null,
      2,
    ) + '\n',
    'utf8',
  );
}

export function graphFixtureDecks(
  depot: string,
): { pkg: string; files: FixtureFile[] }[] {
  return [
    {
      pkg: GRAPH_APP,
      files: [
        {
          path: 'importmap.json',
          bytes: manifest(GRAPH_APP, 'app.js', {
            imports: { dep: graphModuleUrl(depot, GRAPH_DEP, 'index.js') },
            // The whole point: `leaf` is not in `imports`. It resolves only
            // for modules living under dep's own prefix.
            scopes: {
              [`/${depot}/${GRAPH_PUBLISHER}/${GRAPH_DEP}@${GRAPH_VERSION}/`]: {
                leaf: graphModuleUrl(depot, GRAPH_LEAF, 'index.js'),
              },
            },
          }),
        },
        {
          path: 'page.html',
          bytes: Buffer.from(
            '<!doctype html>\n<html>\n<head></head>\n<body>\n' +
              `<script type="module" src="${graphModuleUrl(depot, GRAPH_APP, 'app.js')}"></script>\n` +
              '</body>\n</html>\n',
            'utf8',
          ),
        },
        { path: 'app.js', bytes: Buffer.from("import 'dep';\n", 'utf8') },
      ],
    },
    {
      pkg: GRAPH_DEP,
      files: [
        { path: 'importmap.json', bytes: manifest(GRAPH_DEP, 'index.js') },
        {
          path: 'index.js',
          bytes: Buffer.from("import 'leaf';\nexport const dep = 1;\n", 'utf8'),
        },
      ],
    },
    {
      pkg: GRAPH_LEAF,
      files: [
        { path: 'importmap.json', bytes: manifest(GRAPH_LEAF, 'index.js') },
        { path: 'index.js', bytes: Buffer.from('export const leaf = 1;\n', 'utf8') },
      ],
    },
  ];
}

export async function writeFixtureDepot(
  root: string,
  depot: string = FIXTURE_DEPOT,
): Promise<string> {
  let depotDir = join(root, depot);
  let deckDir = join(depotDir, FIXTURE_PUBLISHER, FIXTURE_PACKAGE);
  await mkdir(join(deckDir, 'nested'), { recursive: true });
  for (let file of fixtureFiles()) {
    await writeFile(join(deckDir, ...file.path.split('/')), file.bytes);
  }
  for (let { pkg, files } of graphFixtureDecks(depot)) {
    let dir = join(depotDir, GRAPH_PUBLISHER, pkg);
    await mkdir(dir, { recursive: true });
    for (let file of files) {
      await writeFile(join(dir, ...file.path.split('/')), file.bytes);
    }
  }
  return depotDir;
}
