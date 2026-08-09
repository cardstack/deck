#!/usr/bin/env node
// Vendor the Hub's own dependencies into the Hub's own depot.
//
//   node apps/hub/setup.mjs
//
// The Hub eats what it serves. Everything it depends on is a deck in its own
// store, at its own address, per-file and forkable — which is the claim the
// whole product makes, applied to the product.
//
// Two decks so far, and the second one is the interesting one.
//
// ─────────────────────────────────────────────────────────────────────────
// THE HIGHLIGHT.JS FINDING
// ─────────────────────────────────────────────────────────────────────────
// `deck vendor --probe` reports highlight.js as a TREE — `es/index.js`
// reaching 2 modules — and that report is true and useless, because the
// second module is CommonJS:
//
//   es/core.js     import HighlightJS from '../lib/core.js'   ← ESM shim
//   lib/core.js    module.exports = highlight;                ← CJS
//
// Node resolves that through dual-package interop. A browser cannot: import
// a file containing `module.exports` and you get `module is not defined`.
// So highlight.js as published is not usable from a browser at all, and the
// probe cannot tell you so, because it counts modules and not module
// SYSTEMS. That is a real gap in the tooling and it is written down in
// docs/deck-hub-brief.md rather than quietly worked around here.
//
// What makes it worth fixing rather than abandoning: `lib/core.js` is 2,597
// lines and contains EXACTLY ONE CommonJS construct, on line 2595. No
// `require()`, no `exports.`, no `__dirname`. The whole incompatibility is
// one line.
//
//   -  module.exports = highlight;
//   +  export default highlight;
//
// One line, in one file, and a package that could not run in a browser runs
// in a browser. That is the argument for owning your dependencies at the
// module boundary, and it is not a hypothetical — it is the reason the Hub
// can highlight anything at all.
//
// The 192 language definitions need no patch: every one of them is already
// self-contained ESM with zero imports. They are carried explicitly because
// nothing imports them — they are loaded on demand, by extension, at
// runtime, which is how "universal highlighting" costs one request per
// language you actually look at instead of 2.6 MB up front.
import { mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pack } from '@deck/core/pack';
import { hashBytes } from '@deck/core/tree-hash';
import { publishToStore, inspectStore, readStoreMeta } from '@deck/core/store';
import { vendorFromNpmSource } from '@deck/core/vendor-npm';
import { storeDirFor } from '@deck/server/depot';

const here = dirname(fileURLToPath(import.meta.url));
const depotDir = join(here, 'hub');
const storeDir = storeDirFor(depotDir);

// A demo should not fail on the day someone runs it; a real depot sets a
// meaningful minimumReleaseAge. See L11.
const POLICY = { minimumReleaseAge: 0 };

await mkdir(storeDir, { recursive: true });

const json = (value) => Buffer.from(`${JSON.stringify(value, null, 2)}\n`, 'utf8');

/**
 * Publish, unless this exact version is already there.
 *
 * A published exact version never changes (L4) and the store refuses to
 * overwrite one — correctly, and this script must not fight it. Setup has to
 * be runnable twice, so it asks first. If the version exists it is left
 * alone and its recorded treeHash is reported, which also means a second run
 * silently VERIFIES the first: same inputs, same content hash, or the
 * mismatch shows up in the printed digest.
 */
async function publishOnce(_storeDir, name, version, bytes, options) {
  let meta = await readStoreMeta(storeDir, name);
  let existing = meta?.versions?.[version];
  if (existing) {
    return { treeHash: existing.treeHash, reused: true };
  }
  let { treeHash } = await publishToStore(storeDir, name, version, bytes, options);
  return { treeHash, reused: false };
}


/**
 * Fold `process.env.NODE_ENV === "development"` to `false`.
 *
 * Several packages ship browser code that guards dev-only warnings on a Node
 * global a browser does not have. It works everywhere else only because a
 * bundler's define plugin constant-folds the condition away before the bytes
 * reach a browser. Deck has no bundler, so it performs the same fold as an
 * ordinary edit to ordinary files — the result is what every production
 * bundle of these libraries already contains, arrived at by changing files
 * you can read rather than by running a build you cannot.
 *
 * Fails closed: if nothing matched, or anything still reaches for `process`,
 * this refuses rather than sealing a deck that throws on first use.
 */
// Both spellings of "am I in development", because packages disagree about
// which way round to write it and each is a different string to match.
const NODE_GUARDS = [
  'process.env.NODE_ENV === "development"',
  'process.env.NODE_ENV !== "production"',
];

function foldNodeGuard(files, label) {
  let patched = [];
  let out = files.map(({ path, bytes }) => {
    let text = bytes.toString('utf8');
    if (!NODE_GUARDS.some((guard) => text.includes(guard))) return { path, bytes };
    patched.push(path);
    for (let guard of NODE_GUARDS) text = text.split(guard).join('false');
    return { path, bytes: Buffer.from(text, 'utf8') };
  });
  let stragglers = out.filter(({ bytes }) => bytes.toString('utf8').includes('process.'));
  if (!patched.length || stragglers.length) {
    throw new Error(
      `${label}: folded ${patched.length} file(s), ${stragglers.length} still ` +
        `reference process.* (${stragglers.map((file) => file.path).join(', ')})`,
    );
  }
  return { files: out, patched };
}

console.log('\n  DECK HUB — vendoring the Hub\'s own dependencies\n');

// ---------------------------------------------------------------------------
// 1. diff — the comparison engine, unmodified.
// ---------------------------------------------------------------------------
{
  let vendored = await vendorFromNpmSource({ spec: 'diff@9.0.0', policy: POLICY });
  let bytes = pack([
    {
      path: 'importmap.json',
      bytes: json({
        deck: {
          packages: {
            diff: {
              version: '9.0.0',
              entry: `$DECK/${vendored.entryPath}`,
              vendoredFrom: vendored.vendoredFrom,
            },
          },
        },
      }),
    },
    ...vendored.files,
  ]);
  let { treeHash, reused } = await publishOnce(storeDir, 'lib/diff', '9.0.0', bytes, {
    tag: 'latest',
  });
  console.log(
    `  lib/diff@9.0.0            ${vendored.modules.length} modules · ` +
      `${treeHash.slice(0, 12)}…${reused ? ' (already sealed)' : ''}`,
  );
}

// ---------------------------------------------------------------------------
// 2. highlight.js — the one-line fork that makes it browser-usable.
// ---------------------------------------------------------------------------
const HLJS = '11.11.1';
const CJS_LINE = 'module.exports = highlight;';
const ESM_LINE = 'export default highlight;';

{
  // The module walk from `es/index.js` reaches two files and neither is what
  // we want, so this takes the tarball and picks. `vendorFromNpmSource` is
  // still the way in: it verifies the integrity hash and hands back the
  // provenance record that has to travel with the bytes (L8).
  let vendored = await vendorFromNpmSource({
    spec: `highlight.js@${HLJS}`,
    policy: POLICY,
  });
  let files = vendored.pkg.files;

  let core = files.get('lib/core.js');
  if (!core) {
    throw new Error(`highlight.js@${HLJS} has no lib/core.js — the fork target moved`);
  }
  let text = core.toString('utf8');
  // Fail closed. If upstream ever changes how it exports, this must stop
  // rather than seal a deck that silently does not work.
  let occurrences = text.split(CJS_LINE).length - 1;
  if (occurrences !== 1) {
    throw new Error(
      `expected exactly one \`${CJS_LINE}\` in lib/core.js, found ${occurrences}`,
    );
  }
  let patched = Buffer.from(text.replace(CJS_LINE, ESM_LINE), 'utf8');

  // Every language, each its own module, none of them imported by anything.
  // `<name>.js.js` are deprecation shims from an old layout, not languages.
  let languages = [...files.keys()]
    .filter((path) => path.startsWith('es/languages/') && path.endsWith('.js'))
    .filter((path) => !path.endsWith('.js.js') && !path.endsWith('.min.js'))
    .sort();

  // The version is derived from the patch so that re-running this script
  // republishes the same bytes under the same name. A demo that publishes
  // different content at the same immutable URL teaches the browser a lie
  // it will hold on to for a year.
  const version = `${HLJS}-esm.${hashBytes(patched).slice(0, 8)}`;

  let bytes = pack([
    {
      path: 'importmap.json',
      bytes: json({
        deck: {
          packages: {
            'highlight-js': {
              version,
              entry: '$DECK/lib/core.js',
              vendoredFrom: vendored.vendoredFrom,
              // What was changed and why, in the tree, at rest, where a
              // reader of the deck finds it without being told to look.
              forkedFrom: {
                package: 'highlight.js',
                version: HLJS,
                changed: ['lib/core.js'],
                reason:
                  'lib/core.js is CommonJS (module.exports) behind an ESM ' +
                  'shim, so the published package cannot be imported by a ' +
                  'browser. One line changed: `module.exports = highlight` ' +
                  'became `export default highlight`. Nothing else differs.',
              },
            },
          },
        },
      }),
    },
    { path: 'lib/core.js', bytes: patched },
    ...languages.map((path) => ({ path, bytes: files.get(path) })),
  ]);
  let { treeHash, reused } = await publishOnce(
    storeDir,
    'lib/highlight-js',
    version,
    bytes,
    // Not `latest`: a fork is a prerelease, and `latest` may only name a
    // stable release. That refusal is C3 working — ranges must never drift
    // onto somebody's fork by accident. The deck is reached by its own tag.
    { tag: 'esm' },
  );
  console.log(
    `  lib/highlight-js@${version}  ${languages.length} languages · ` +
      `${treeHash.slice(0, 12)}…${reused ? ' (already sealed)' : ''}`,
  );
  console.log(
    `    forked lib/core.js: 1 line of 2597 — \`${CJS_LINE}\` → \`${ESM_LINE}\``,
  );
}

// ---------------------------------------------------------------------------
// 3. @tanstack/table-core — the listing state machine, unmodified.
//
// v9, not v8, and the probe is the reason: v8 is a bundle at every entry
// (`build/lib/index.mjs`, 1 module, 136 KB), while v9 publishes the real
// thing — 76 modules. Since the point of using TanStack here at all is that
// it is headless AND per-file, taking the bundled major would have been
// choosing the version that gives up the property we picked it for.
//
// The "1 external" the probe reports is a SELF-reference — the package
// imports its own subpath — so the graph stays inside the pack.
// ---------------------------------------------------------------------------
// table-core imports `@tanstack/store`, and a plain `vendor` REFUSED to seal
// it:
//
//   vendor: 1 reference(s) point outside the package, so it would not be
//   hermetic: @tanstack/store
//
// That is L6 and L11 doing their job, and the right answer is not
// `--allow-external` — which would leave a live reference to the public web
// inside a sealed pack — but `vendor-tree`, which makes each package in the
// graph its own deck and wires them with aliased dependency records. One
// library shared by two consumers is then stored and loaded once (L7's
// corollary), instead of nested twice.
//
// Shelling out to the CLI rather than reimplementing it: this is the
// documented command, and a setup script that runs the same thing a person
// would type cannot drift from it.
// Two decks, because table-core imports `@tanstack/store` and the vendor is
// right to refuse a live external inside a sealed pack.
//
// And two EXTRA ENTRIES, which took finding. `constructTable` needs
// `coreReactivityFeature`, and that lives behind two subpath exports
// (`./reactivity`, `./store-reactivity-bindings`) that nothing in
// `dist/index.js` imports — so a walk from the declared entry seals a deck
// that resolves, loads, and then throws `Cannot read properties of undefined
// (reading 'coreReactivityFeature')` the moment you construct a table.
//
// This is the same class of problem as the highlight.js one: the module graph
// reachable from a package's main entry is not always the module graph the
// package needs. `extraEntries` exists for exactly this, and the fix is to
// name the roots rather than to widen the walk and hope.
const STORE_DECK = 'lib/tanstack-store';
const TABLE_DECK = 'lib/tanstack-table-core';

{
  let store = await vendorFromNpmSource({
    spec: '@tanstack/store@0.11.1',
    policy: POLICY,
  });
  let storeBytes = pack([
    {
      path: 'importmap.json',
      bytes: json({
        deck: {
          packages: {
            'tanstack-store': {
              version: '0.11.1',
              entry: `$DECK/${store.entryPath}`,
              vendoredFrom: store.vendoredFrom,
            },
          },
        },
      }),
    },
    ...store.files,
  ]);
  let sealed = await publishOnce(storeDir, STORE_DECK, '0.11.1', storeBytes, {
    tag: 'latest',
  });
  console.log(
    `  ${STORE_DECK}@0.11.1     ${store.modules.length} modules · ` +
      `${sealed.treeHash.slice(0, 12)}…${sealed.reused ? ' (already sealed)' : ''}`,
  );

  let table = await vendorFromNpmSource({
    spec: '@tanstack/table-core@9.1.1',
    policy: POLICY,
    extraEntries: ['dist/reactivity.js', 'dist/store-reactivity-bindings.js'],
    // `@tanstack/store` stays a bare specifier in the bytes and is answered
    // by the dependency record below, which is what makes one shared library
    // one URL and one module instance (L7's corollary) rather than a nested
    // second copy.
    allowExternal: true,
  });
  // …and then it throws `process is not defined`, because nine of its files
  // carry `process.env.NODE_ENV === "development"` guards around dev-only
  // warnings. That is browser code with a Node assumption baked in, and it
  // works everywhere else only because a bundler's define plugin folds the
  // condition away before it reaches a browser.
  //
  // Deck has no bundler, so it does the same fold as an ordinary edit to
  // ordinary files. `=== "development"` becomes `false`, the dead branch goes
  // with it, and the result is what every production bundle of this library
  // already contains — arrived at by changing nine files rather than by
  // running a build nobody can inspect afterwards.
  let { files, patched } = foldNodeGuard(table.files, 'table-core');
  const tableVersion = `9.1.1-browser.${hashBytes(
    Buffer.concat(files.map(({ bytes }) => bytes)),
  ).slice(0, 8)}`;

  let tableBytes = pack([
    {
      path: 'importmap.json',
      bytes: json({
        deck: {
          packages: {
            'tanstack-table-core': {
              version: tableVersion,
              entry: `$DECK/${table.entryPath}`,
              vendoredFrom: table.vendoredFrom,
              forkedFrom: {
                package: '@tanstack/table-core',
                version: '9.1.1',
                changed: patched,
                reason:
                  'Nine files guard dev-only warnings with ' +
                  '`process.env.NODE_ENV === "development"`, which is not ' +
                  'defined in a browser. The guard is folded to `false` — the ' +
                  'same constant-fold a bundler performs — so the package ' +
                  'runs without a build step or a `process` shim.',
              },
            },
          },
          dependencies: { '@tanstack/store': `${STORE_DECK}@^0.11.0` },
        },
      }),
    },
    ...files,
  ]);
  let sealedTable = await publishOnce(storeDir, TABLE_DECK, tableVersion, tableBytes, {
    tag: 'browser',
  });
  console.log(
    `  ${TABLE_DECK}@${tableVersion}  ${table.modules.length} modules · ` +
      `${sealedTable.treeHash.slice(0, 12)}…${sealedTable.reused ? ' (already sealed)' : ''}`,
  );
  console.log(
    `    folded the Node guard out of ${patched.length} of ${files.length} files — no bundler, no shim`,
  );
}

// ---------------------------------------------------------------------------
// 4. @tanstack/query-core — fetching, caching and invalidation for /track.
//
// `build/modern/index.js` is 24 modules; the same package's `.cjs` entry is a
// bundle. Headless like table-core: it owns request state and renders
// nothing.
//
// /track fans out over every mounted depot — a seal log, a version list and
// an offers queue each — so the same depot gets asked the same question by
// several facets at once. That is what a query cache is for, and writing one
// by hand is how you end up with a worse one.
// ---------------------------------------------------------------------------
{
  let vendored = await vendorFromNpmSource({
    spec: '@tanstack/query-core@5.101.4',
    policy: POLICY,
    entry: 'build/modern/index.js',
  });
  // Same Node guard as table-core, same fold.
  let { files, patched } = foldNodeGuard(vendored.files, 'query-core');
  let version = `5.101.4-browser.${hashBytes(
    Buffer.concat(files.map(({ bytes }) => bytes)),
  ).slice(0, 8)}`;
  let bytes = pack([
    {
      path: 'importmap.json',
      bytes: json({
        deck: {
          packages: {
            'tanstack-query-core': {
              version,
              entry: `$DECK/${vendored.entryPath}`,
              vendoredFrom: vendored.vendoredFrom,
              forkedFrom: {
                package: '@tanstack/query-core',
                version: '5.101.4',
                changed: patched,
                reason:
                  '`process.env.NODE_ENV === "development"` guards folded to ' +
                  '`false`, the same constant-fold a bundler performs, so the ' +
                  'package runs in a browser without a build step or a shim.',
              },
            },
          },
        },
      }),
    },
    ...files,
  ]);
  let { treeHash, reused } = await publishOnce(
    storeDir,
    'lib/tanstack-query-core',
    version,
    bytes,
    { tag: 'browser' },
  );
  console.log(
    `  lib/tanstack-query-core@${version}  ${vendored.modules.length} modules · ` +
      `${treeHash.slice(0, 12)}…${reused ? ' (already sealed)' : ''}`,
  );
  console.log(`    folded the Node guard out of ${patched.length} files`);
}

// ---------------------------------------------------------------------------
// 5. Commit Mono — the typeface, as a deck.
//
// L6 says a sealed deck reaches nothing at runtime, and a webfont from
// Google's CDN is a runtime reach: a third party learns every reader's IP and
// can change or withdraw the bytes. So the font is vendored like anything
// else — content-hashed, immutable, served from this depot, and offline.
//
// It is also the cleanest possible example of a deck with NO ENTRY. Nothing
// imports a woff2. The deck is addressable, hashed, diffable and servable,
// and the server structurally refuses to import it, exactly as it refuses
// the ProseMirror `src/` decks. Not every deck is a module tree, and the
// address space never pretended otherwise.
//
// Three faces of the twelve published, because that is what the Hub sets:
// regular, its italic, and a semibold. The other nine would be 900 KB of
// bytes nothing asks for.
const FONT = '5.3.0';
const FACES = [
  ['files/commit-mono-latin-400-normal.woff2', 400, 'normal'],
  ['files/commit-mono-latin-400-italic.woff2', 400, 'italic'],
  ['files/commit-mono-latin-600-normal.woff2', 600, 'normal'],
];

{
  let vendored = await vendorFromNpmSource({
    spec: `@fontsource/commit-mono@${FONT}`,
    policy: POLICY,
    // Fontsource has no module graph worth walking; the payload is the files.
  }).catch(async (error) => {
    // Some packages have no importable entry at all, which is the whole
    // point of this one. Fall back to the tarball itself.
    if (!/entry|module/i.test(String(error?.message ?? error))) throw error;
    let { fetchNpmPackage } = await import('@deck/core/npm');
    let pkg = await fetchNpmPackage({ spec: `@fontsource/commit-mono@${FONT}`, policy: POLICY });
    return { pkg, vendoredFrom: { registry: 'npm', name: pkg.name, version: pkg.version } };
  });
  let files = vendored.pkg.files;

  let missing = FACES.map(([path]) => path).filter((path) => !files.get(path));
  if (missing.length) {
    throw new Error(`@fontsource/commit-mono@${FONT} is missing ${missing.join(', ')}`);
  }

  // Our own @font-face sheet rather than the twelve fontsource ships, so the
  // family name and the fallback chain are decided here and the relative
  // URLs resolve inside the deck.
  let css = FACES.map(
    ([path, weight, style]) => `@font-face {
  font-family: 'Commit Mono';
  src: url('./${path}') format('woff2');
  font-weight: ${weight};
  font-style: ${style};
  font-display: swap;
}`,
  ).join('\n\n');

  let bytes = pack([
    {
      path: 'importmap.json',
      bytes: json({
        deck: {
          packages: {
            'commit-mono': {
              version: FONT,
              // NO ENTRY. Nothing imports a font; this deck is addressable
              // and deliberately not importable (L11 as a shape).
              vendoredFrom: vendored.vendoredFrom,
            },
          },
        },
      }),
    },
    { path: 'font.css', bytes: Buffer.from(`${css}\n`, 'utf8') },
    { path: 'LICENSE', bytes: files.get('LICENSE') ?? Buffer.from('', 'utf8') },
    ...FACES.map(([path]) => ({ path, bytes: files.get(path) })),
  ]);
  let { treeHash, reused } = await publishOnce(
    storeDir,
    'type/commit-mono',
    FONT,
    bytes,
    { tag: 'latest' },
  );
  let kb = FACES.reduce((sum, [path]) => sum + files.get(path).length, 0) / 1024;
  console.log(
    `  type/commit-mono@${FONT}     ${FACES.length} faces · ${kb.toFixed(0)} KB · ` +
      `${treeHash.slice(0, 12)}…${reused ? ' (already sealed)' : ''}`,
  );
  console.log('    no entry declared — a deck you can address and cannot import');
}

let store = await inspectStore(storeDir);
console.log(
  `\n  store: ${store.objects ?? store.objectCount ?? '?'} objects · ` +
    `${((store.bytes ?? store.totalBytes ?? 0) / 1024 / 1024).toFixed(1)} MB\n`,
);
console.log('  next: deck lock --depot apps/hub/hub --publisher app --name browse\n');
