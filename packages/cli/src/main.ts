import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import {
  treeHashFromDir,
  formatTreeHash,
  hashBytes,
} from '@deck/core/tree-hash';
import { pack, packFromDir, peekPacklist, unpack } from '@deck/core/pack';
import { readZipEntry } from '@deck/core/canonical-zip';
import {
  collectStoreGarbage,
  inspectStore,
  migrateStore,
  pruneDevVersions,
  publishToStore,
  readStoredPack,
  readStoreMeta,
  releaseVersion,
  setDistTag,
} from '@deck/core/store';
import { forkDeck } from '@deck/core/fork';
import { rebasePass, startRebaseDaemon } from '@deck/server/rebase-daemon';
import { lockDeck, parseDependencyValue } from '@deck/core/lock';
import { assertLinksOk, verifyLinks } from '@deck/core/verify-links';
import {
  derivationFromMap,
  deriveMinified,
  derivedPack,
  terserVersion,
  verifyDerivation,
} from '@deck/core/derive';
import { vendorFromCdn, vendorImportMap } from '@deck/core/vendor';
import {
  deckNameForNpm,
  probeEntries,
  vendorFromNpmSource,
} from '@deck/core/vendor-npm';
import { fetchNpmPackage, verifyAgainstGithubTree } from '@deck/core/npm';
import {
  mapVendorImportMap,
  vendorFromSourceMap,
} from '@deck/core/vendor-map';
import {
  planVendorTree,
  vendorUnitImportMap,
} from '@deck/core/vendor-tree';
import { createDeckServer } from '@deck/server/server';
import {
  discoverDecks,
  readRealmPolicy,
  storeDirFor,
  watchRealm,
  type RealmMount,
} from '@deck/server/realm';
import { createKey, listKeys, resolveKey } from '@deck/core/keyring';
import {
  appendSignature,
  readEnvelope,
  signTreeHash,
  verifyEnvelope,
} from '@deck/core/signature';
import { formatReport } from '@deck/conformance/laws';
import { runConformance } from '@deck/conformance/run';
import { applyRestore } from '@deck/history/backend';
import { createHistory, isValidHistoryKind } from '@deck/history/create';

// Seal a SECOND tree beside a published version: same source, minified,
// its own treeHash, its own version, its own address, tagged `production`.
// Nothing about the source version changes; a consumer opts in.
async function deriveMinifiedRelease(
  storeDir: string,
  scoped: string,
  sourceVersion: string,
): Promise<void> {
  let sourcePack = await readStoredPack(storeDir, scoped, sourceVersion);
  if (!sourcePack) {
    fail(`${scoped}@${sourceVersion} has no stored content to derive from`);
  }
  let derived = await deriveMinified({
    packBytes: sourcePack!,
    sourceVersion,
    packageName: scoped,
    terserVersion: await terserVersion(),
  });
  let bytes = derivedPack(derived);
  await publishToStore(storeDir, scoped, derived.version, bytes, {
    tag: 'production',
  });
  let saved = derived.sourceBytes - derived.derivedBytes;
  console.log(
    `derived ${scoped}@${derived.version} — ${derived.minifiedPaths.length} file(s) minified, ${(derived.sourceBytes / 1024).toFixed(0)} KB → ${(derived.derivedBytes / 1024).toFixed(0)} KB (${((saved / derived.sourceBytes) * 100).toFixed(0)}% smaller), tag production`,
  );
  console.log(
    `  derivedFrom ${derived.derivedFrom.slice(0, 12)} via ${derived.derivation.tool} — \`deck verify-derivation\` re-runs it`,
  );
}

// The Deck CLI is the WRITE side of the standalone protocol: it arranges
// at-rest state (packs, the store). The server is read-only. Together they
// are the reference implementation any other implementor (the Boxel realm
// server included) must agree with byte-for-byte.

const HELP = `deck — the Deck protocol CLI

A realm is a directory; its layout IS its URL space:

  <root>/<realm>/<publisher>/<package>/app.js   on disk
  /<realm>/<publisher>/<package>/app.js         live, every save visible
  /<realm>/<publisher>/<package>@1.2.0/app.js   the sealed copy
  /<realm>/_history/<changeId>/<path>           any state, published or not

Sealed versions live in <realm>/.deck/store/, seals in <realm>/.jj/ — both
inside the realm, both invisible to the tree hash, so a realm directory is
self-contained and movable.

Usage:
  deck hello [dir] [--port <p>]         scaffold a live realm and serve it — start here
  deck hash <dir>                       print the canonical tree hash
  deck pack <dir> [--output <file>] [--created-by <who>] [--source <realm>]
                                        create <basename>.pack.zip
  deck unpack <file> [--into <dir>] [--force]
                                        extract a verified pack
  deck list <file>                      show a pack's packlist
  deck verify <file|dir>                verify a pack / hash a directory
  deck publish <file> --realm <dir> --publisher <p> --name <n> --version <v> [--tag <t>]
                                        publish a pack into a realm's store
  deck tag --realm <dir> --publisher <p> --name <n> --tag <t> --version <v>
                                        move a dist-tag
  deck release --realm <dir> --publisher <p> --name <n> --version <v>
               --from <tag-or-version> [--tag <t>] [--require-signature] [--minify]
                                        name an existing sealed state as a new
                                        version — a pointer, never a copy
  deck vendor <cdn-url> --name <n> --version <v> [--realm <dir> --publisher <p>]
              [--tag <t>] [--output <file>] [--allow-external] [--allow-host <h>]...
                                        pull a library's whole module graph
                                        from esm.sh/unpkg/jsdelivr ONCE,
                                        rewrite every reference to stay
                                        inside the pack, and seal it — your
                                        own unpkg, hermetic by default
  deck vendor npm:<pkg>@<version> --mode map [--entry <path>]
                                        MAP mode, for a package that ships
                                        only a bundle: recover the pre-bundle
                                        module tree from the source map.
                                        Readable and diffable against
                                        upstream; NOT executable, so the deck
                                        declares no entry and nothing can
                                        import it
  deck vendor npm:<pkg>@<version> [--entry <path>] [--verify-repo] [--probe]
              [--name <n>] [--version <v>] [--realm <dir> --publisher <p>] [--tag <t>]
                                        SOURCE mode: vendor the module tree
                                        npm published instead of a CDN's
                                        bundle, so every file is a separate
                                        address you can fork and edit.
                                        --probe reports what each candidate
                                        entry reaches without vendoring.
                                        --verify-repo checks the tree against
                                        the GitHub commit npm recorded, blob
                                        by blob
  deck vendor-tree npm:<pkg>[@<range>] --realm <dir> --publisher <p>
              [--minimum-release-age <minutes>] [--min-age-days <days>]
              [--max-depth <n>] [--allow-external] [--dry-run]
                                        vendor a package AND its dependency
                                        graph, each as its own deck, wired by
                                        aliased dependency records. Refuses a
                                        version published in the last
                                        --min-age days (default 30) and
                                        resolves ranges to the newest release
                                        that IS old enough
  deck prune --realm <dir> --publisher <p> --name <n> [--keep <k>]
                                        drop old -dev.N prereleases (never
                                        stables or tag targets); bytes are
                                        deleted only when nothing points at them
  deck serve --root <dir> | --realm <dir> --as <name> ...
             [--port <p>] [--history auto|jj|historyd|none] [--rebase]
                                        start the read-only Deck server; every
                                        deck under a realm is served live and
                                        auto-published as <base>-dev.N;
                                        --history seals every save (tier 2);
                                        --rebase keeps every open proposal
                                        merged against upstream, continuously
  deck fork --realm <dir> --from <pub>/<pkg>[@<version>] --as <pub>/<pkg>
            [--use-in <pub>/<pkg>] [--force]
                                        copy someone's deck into YOUR publisher
                                        scope and start changing it — separate
                                        version line, separate dist-tags, their
                                        versions never move; --use-in repoints
                                        that deck's dependency at the fork, live
  deck lock --realm <dir> --publisher <p> --name <n> [--check]
                                        resolve this deck's declared
                                        dependency RANGES to exact versions and
                                        pin them in its import map — what your
                                        users get, so they never inherit
                                        somebody else's working tree
  deck offers --realm <dir> [--onto <spec>] [--json]
                                        every open proposal in the realm and
                                        whether it still merges with upstream
  deck rebase --realm <dir> [--onto <spec>] [--check]
                                        re-merge every proposal against
                                        upstream; clean ones are written back
                                        (and auto-publish), conflicted ones are
                                        reported and left untouched
  deck store <status|migrate|gc> --realm <dir> [--dry-run] [--keep-archives]
                                        status: what the store holds and what
                                        is reclaimable. migrate: convert a
                                        legacy packs/ store into per-file
                                        objects, proving each rebuild is
                                        byte-identical before deleting
                                        anything. gc: drop trees and objects
                                        no published version points at
  deck derive --realm <dir> --publisher <p> --name <n> --version <v> [--minify]
                                        seal a minified tree beside a
                                        published version: own treeHash, own
                                        version <v>-min.0, tag "production".
                                        The source version does not change
  deck verify-derivation --realm <dir> --publisher <p> --name <n> --version <v>
                                        re-run a derived tree's recorded
                                        derivation over its source and
                                        require the same treeHash. A
                                        derivation nobody can reproduce is
                                        decoration, so this refuses
  deck verify-links --realm <dir> [--publisher <p> --name <n>]
                    [--require-signature <n>]
                                        L11: check that every pin still
                                        resolves to what its dependency
                                        record implies, that every pin has a
                                        record and every record a pin, and
                                        that the files named actually exist.
                                        A stale lock is a lie about what will
                                        be served, so this refuses rather
                                        than warns
  deck keygen [--label <l>] [--list]     create a local ed25519 signing key
  deck sign --realm <dir> --publisher <p> --name <n> --version <v>
            [--key <id>] [--role publish|dev]
                                        endorse a version's TREE HASH. The
                                        envelope lives with the tree, so a
                                        fork of the same bytes inherits it
  deck verify-sig --realm <dir> [--tree-hash <hex>
            | --publisher <p> --name <n> --version <v>] [--require <n>]
                                        check endorsements; --require fails
                                        unless at least n signatures verify
  deck conform [--url <base> --realm <name>] [--at-rest] [--http] [--json]
                                        run the executable contract. With no
                                        --url it stands the canonical fixture
                                        realm up on the reference server and
                                        measures that; with one it measures
                                        ANY implementation black-box, which is
                                        how the Boxel realm server will show
                                        it implements Deck. See docs/deck-laws.md
  deck history <realm-dir> [--limit <n>] [--json]
                                        list a realm's seals — every state it
                                        has been in, published or not
  deck restore <realm-dir> <changeId>   put the realm back to a sealed state;
                                        the state you leave is sealed first, and
                                        the restored one auto-publishes as the
                                        next dev version

On a running server, open /deckbook.html for the teaching tour (Deckbook).
`;

// `--minimum-release-age` is pnpm's setting in pnpm's units (minutes);
// `--min-age-days` is the same dial for humans who think in days. Either
// overrides whatever the realm's policy.json declares.
function cooldownOverride(values: {
  'minimum-release-age'?: string;
  'min-age-days'?: string;
}): { minimumReleaseAge?: number } {
  if (values['minimum-release-age'] !== undefined) {
    return { minimumReleaseAge: Number(values['minimum-release-age']) };
  }
  if (values['min-age-days'] !== undefined) {
    return { minimumReleaseAge: Number(values['min-age-days']) * 1440 };
  }
  return {};
}

// 8787 is jj-historyd's default; a deck server sharing a machine with one
// would collide silently, so the server sits next door.
const DEFAULT_PORT = '8788';

// `deck hello` is a runme: a busy port is not something to make the reader
// solve. Explicit `--port` is honoured exactly; the default walks forward.
async function listenNear(
  server: { listen: (port: number, cb: () => void) => void; once: (event: string, cb: (error: NodeJS.ErrnoException) => void) => void; removeAllListeners: (event: string) => void },
  port: number,
  attempts = 10,
): Promise<number> {
  for (let candidate = port; candidate < port + attempts; candidate++) {
    let listening = await new Promise<boolean>((resolve) => {
      server.once('error', (error: NodeJS.ErrnoException) => {
        if (error.code === 'EADDRINUSE') {
          resolve(false);
        } else {
          throw error;
        }
      });
      server.listen(candidate, () => resolve(true));
    });
    server.removeAllListeners('error');
    if (listening) {
      return candidate;
    }
  }
  throw new Error(`no free port in ${port}..${port + attempts - 1}`);
}

function fail(message: string): never {
  console.error(`error: ${message}`);
  process.exit(1);
}

async function main(): Promise<void> {
  let [command, ...rest] = process.argv.slice(2);
  switch (command) {
    case 'hash': {
      let [dir] = rest;
      if (!dir) fail('usage: deck hash <dir>');
      let result = await treeHashFromDir(resolve(dir));
      console.log(formatTreeHash(result));
      return;
    }
    case 'pack': {
      let { values, positionals } = parseArgs({
        args: rest,
        allowPositionals: true,
        options: {
          output: { type: 'string' },
          'created-by': { type: 'string' },
          source: { type: 'string' },
        },
      });
      let [dir] = positionals;
      if (!dir) fail('usage: deck pack <dir> [--output <file>]');
      let provenance: Record<string, string> = {};
      if (values['created-by']) provenance.createdBy = values['created-by'];
      if (values.source) provenance.sourceRealm = values.source;
      let bytes = await packFromDir(
        resolve(dir),
        Object.keys(provenance).length > 0 ? provenance : undefined,
      );
      let output = values.output ?? `${basename(resolve(dir))}.pack.zip`;
      await writeFile(output, bytes);
      let packlist = peekPacklist(bytes);
      console.log(
        `${output}: ${packlist.entries.length} files, treeHash ${packlist.treeHash.hash}`,
      );
      return;
    }
    case 'unpack': {
      let { values, positionals } = parseArgs({
        args: rest,
        allowPositionals: true,
        options: {
          into: { type: 'string' },
          force: { type: 'boolean', default: false },
        },
      });
      let [file] = positionals;
      if (!file) fail('usage: deck unpack <file> [--into <dir>] [--force]');
      let opened = unpack(await readFile(file));
      let target = resolve(
        values.into ?? basename(file).replace(/\.pack\.zip$/, ''),
      );
      let created = 0;
      let skipped = 0;
      for (let [path, bytes] of opened.files) {
        let destination = join(target, ...path.split('/'));
        let exists = await stat(destination).then(
          () => true,
          () => false,
        );
        if (exists && !values.force) {
          let current = await readFile(destination);
          if (hashBytes(current) === hashBytes(bytes)) {
            skipped++; // identical content always skips
            continue;
          }
          fail(
            `${destination} exists with different content (use --force to overwrite)`,
          );
        }
        await mkdir(dirname(destination), { recursive: true });
        await writeFile(destination, bytes);
        created++;
      }
      console.log(
        `unpacked into ${target}: ${created} written, ${skipped} identical-skipped, treeHash ${opened.treeHash}`,
      );
      return;
    }
    case 'list': {
      let [file] = rest;
      if (!file) fail('usage: deck list <file>');
      let packlist = peekPacklist(await readFile(file));
      console.log(
        `format ${packlist.format} (${packlist.canonicalZip}), treeHash ${packlist.treeHash.hash}`,
      );
      if (packlist.provenance) {
        console.log(`provenance: ${JSON.stringify(packlist.provenance)}`);
      }
      for (let entry of packlist.entries) {
        console.log(
          `  ${entry.sha256.slice(0, 12)}  ${String(entry.size).padStart(8)}  ${entry.path}`,
        );
      }
      return;
    }
    case 'verify': {
      let [target] = rest;
      if (!target) fail('usage: deck verify <file|dir>');
      let stats = await stat(resolve(target));
      if (stats.isDirectory()) {
        let result = await treeHashFromDir(resolve(target));
        console.log(`ok: directory, ${formatTreeHash(result)}`);
      } else {
        let opened = unpack(await readFile(target));
        console.log(
          `ok: ${opened.files.size} files verified, treeHash ${opened.treeHash}`,
        );
      }
      return;
    }
    case 'publish': {
      let { values, positionals } = parseArgs({
        args: rest,
        allowPositionals: true,
        options: {
          realm: { type: 'string' },
          publisher: { type: 'string' },
          name: { type: 'string' },
          version: { type: 'string' },
          tag: { type: 'string' },
        },
      });
      let [file] = positionals;
      if (
        !file ||
        !values.realm ||
        !values.publisher ||
        !values.name ||
        !values.version
      ) {
        fail(
          'usage: deck publish <file> --realm <dir> --publisher <p> --name <n> --version <v> [--tag <t>]',
        );
      }
      let scoped = `${values.publisher}/${values.name}`;
      let { treeHash } = await publishToStore(
        storeDirFor(resolve(values.realm)),
        scoped,
        values.version,
        await readFile(file),
        { tag: values.tag },
      );
      console.log(
        `published ${scoped}@${values.version} (treeHash ${treeHash})${values.tag ? ` tag ${values.tag}` : ''}`,
      );
      return;
    }
    case 'tag': {
      let { values } = parseArgs({
        args: rest,
        options: {
          realm: { type: 'string' },
          publisher: { type: 'string' },
          name: { type: 'string' },
          tag: { type: 'string' },
          version: { type: 'string' },
        },
      });
      if (
        !values.realm ||
        !values.publisher ||
        !values.name ||
        !values.tag ||
        !values.version
      ) {
        fail(
          'usage: deck tag --realm <dir> --publisher <p> --name <n> --tag <t> --version <v>',
        );
      }
      let scoped = `${values.publisher}/${values.name}`;
      await setDistTag(
        storeDirFor(resolve(values.realm)),
        scoped,
        values.tag,
        values.version,
      );
      console.log(`${scoped} ${values.tag} → ${values.version}`);
      return;
    }
    case 'release': {
      let { values } = parseArgs({
        args: rest,
        options: {
          realm: { type: 'string' },
          publisher: { type: 'string' },
          name: { type: 'string' },
          version: { type: 'string' },
          from: { type: 'string' },
          tag: { type: 'string' },
          'require-signature': { type: 'boolean', default: false },
          minify: { type: 'boolean', default: false },
        },
      });
      if (
        !values.realm ||
        !values.publisher ||
        !values.name ||
        !values.version ||
        !values.from
      ) {
        fail(
          'usage: deck release --realm <dir> --publisher <p> --name <n> --version <v> --from <tag-or-version> [--tag <t>]',
        );
      }
      let scoped = `${values.publisher}/${values.name}`;
      // A leading digit means a source version; otherwise a dist-tag.
      let from = /^[0-9]/.test(values.from)
        ? { version: values.from }
        : { tag: values.from };
      // L9 as policy: an auto-published dev line may be unsigned, but a
      // stable release is a deliberate human act and can be made to require
      // a deliberate human endorsement. Off by default so a keyless install
      // is never bricked; the release line says which it was.
      if (values['require-signature']) {
        let storeDir = storeDirFor(resolve(values.realm!));
        let meta = await readStoreMeta(storeDir, scoped);
        let sourceVersion =
          from.version ?? (from.tag ? meta?.tags[from.tag] : undefined);
        let treeHash = sourceVersion
          ? meta?.versions[sourceVersion]?.treeHash
          : undefined;
        if (!treeHash) {
          fail(`cannot resolve ${values.from} for ${scoped}`);
        }
        let envelope = await readEnvelope(storeDir, treeHash!);
        let valid = envelope ? verifyEnvelope(treeHash!, envelope).valid : [];
        if (!valid.some((signature) => signature.role === 'publish')) {
          fail(
            `L9: ${scoped}@${values.version} has no valid publish signature on ${treeHash!.slice(0, 12)} — run \`deck sign\` first, or drop --require-signature`,
          );
        }
      }
      let record = await releaseVersion(
        storeDirFor(resolve(values.realm!)),
        scoped,
        values.version!,
        from,
        { tag: values.tag },
      );
      console.log(
        `released ${scoped}@${values.version} from ${values.from}: same sealed state (treeHash ${record.treeHash}), zero bytes copied${values.tag ? `, tag ${values.tag}` : ''}${values['require-signature'] ? ' — endorsed' : ''}`,
      );

      if (values.minify) {
        await deriveMinifiedRelease(
          storeDirFor(resolve(values.realm!)),
          scoped,
          values.version!,
        );
      }
      return;
    }
    case 'vendor': {
      let { values, positionals } = parseArgs({
        args: rest,
        allowPositionals: true,
        options: {
          name: { type: 'string' },
          version: { type: 'string' },
          realm: { type: 'string' },
          publisher: { type: 'string' },
          tag: { type: 'string' },
          output: { type: 'string' },
          'allow-external': { type: 'boolean', default: false },
          'allow-host': { type: 'string', multiple: true, default: [] },
          entry: { type: 'string' },
          probe: { type: 'boolean', default: false },
          'verify-repo': { type: 'boolean', default: false },
          mode: { type: 'string' },
        },
      });
      let [url] = positionals;
      if (!url) {
        fail(
          'usage: deck vendor <cdn-url|npm:pkg@version> --name <n> --version <v> [--realm <dir> --publisher <p>] [--output <file>]',
        );
      }
      let isNpm = url.startsWith('npm:');

      // Source mode: the tree npm published, not a CDN's bundle. Probing
      // reports what each candidate entry reaches and stops there, because
      // "how many modules is this actually" is the question you want
      // answered BEFORE you seal anything.
      if (isNpm && values.probe) {
        let pkg = await fetchNpmPackage({ spec: url.slice(4) });
        let probes = probeEntries(pkg);
        console.log(
          `${pkg.name}@${pkg.version} — ${pkg.files.size} published files`,
        );
        if (probes.length === 0) {
          console.log('  no ES module entry found');
        }
        for (let probe of probes) {
          console.log(
            `  ${probe.modules === 1 ? 'bundle ' : 'tree   '} ${probe.entry}  ${probe.modules} module(s), ${(probe.bytes / 1024).toFixed(0)} KB${probe.externals ? `, ${probe.externals} external` : ''}${probe.unresolved ? `, ${probe.unresolved} unresolved` : ''}`,
          );
        }
        console.log(
          '\na candidate reaching 1 module is a bundle: the boundary was lost at publish time.',
        );
        return;
      }

      if (!isNpm && (!values.name || !values.version)) {
        fail(
          'usage: deck vendor <cdn-url> --name <n> --version <v> [--realm <dir> --publisher <p>] [--output <file>]',
        );
      }
      if ((values.realm === undefined) !== (values.publisher === undefined)) {
        fail('publishing a vendored pack needs both --realm and --publisher');
      }

      let entryPath: string;
      let vendoredFiles: { path: string; bytes: Buffer }[];
      let moduleCount: number;
      let externals: string[];
      let provenance: string | Record<string, unknown>;
      let deckName: string;
      let deckVersion: string;

      if (isNpm && values.mode === 'map') {
        // Recovered, not published: the tree comes out of the bundle's
        // source map. It is for reading, diffing and raising a pull
        // request — never for execution, which is why no entry is declared.
        let recovered = await vendorFromSourceMap({
          spec: url.slice(4),
          entry: values.entry,
        });
        deckName = values.name ?? deckNameForNpm(recovered.pkg.name);
        deckVersion = values.version ?? recovered.pkg.version;
        console.log(
          `recovered ${recovered.modules} module(s) from ${recovered.mapFrom} (bundle ${recovered.bundleEntry})`,
        );
        if (recovered.escaped.length > 0) {
          console.log(
            `  ${recovered.escaped.length} source(s) resolved outside the package, filed under _outside/`,
          );
        }
        if (recovered.missingContent.length > 0) {
          console.log(
            `  ${recovered.missingContent.length} source(s) had no inlined content and could not be recovered`,
          );
        }
        console.log(
          '  NOT EXECUTABLE: this is pre-bundle source, so the deck declares no entry',
        );
        entryPath = recovered.bundleEntry;
        vendoredFiles = recovered.files;
        moduleCount = recovered.modules;
        externals = [];
        provenance = recovered.vendoredFrom as unknown as Record<string, unknown>;
        let bytes = pack([
          {
            path: 'importmap.json',
            bytes: mapVendorImportMap(deckName, deckVersion, recovered),
          },
          ...recovered.files,
        ]);
        console.log(`  treeHash ${peekPacklist(bytes).treeHash.hash}`);
        if (values.realm && values.publisher) {
          let realmDir = resolve(values.realm);
          await publishToStore(
            storeDirFor(realmDir),
            `${values.publisher}/${deckName}`,
            deckVersion,
            bytes,
            { tag: values.tag },
          );
          console.log(
            `published ${values.publisher}/${deckName}@${deckVersion} — read it at /${basename(realmDir)}/${values.publisher}/${deckName}@${deckVersion}/`,
          );
        }
        if (values.output || !values.realm) {
          let output = values.output ?? `${deckName}-${deckVersion}.pack.zip`;
          await writeFile(output, bytes);
          console.log(`wrote ${output}`);
        }
        return;
      }

      if (isNpm) {
        let source = await vendorFromNpmSource({
          spec: url.slice(4),
          entry: values.entry,
          allowExternal: values['allow-external'],
        });
        if (values['verify-repo']) {
          let { repo, commit, subtree } = source.vendoredFrom;
          if (!repo || !commit) {
            fail(
              'verify-repo: the registry recorded no repository/commit for this version',
            );
          }
          let verification = await verifyAgainstGithubTree({
            repo: repo!,
            commit: commit!,
            subtree: subtree ?? '',
            files: source.pkg.files,
          });
          source.vendoredFrom.repoVerified = {
            matched: verification.matched,
            total: verification.total,
          };
          console.log(
            `repo check ${verification.matched}/${verification.total} blobs identical to ${repo}@${commit.slice(0, 10)}${subtree ? `:${subtree}` : ''}`,
          );
          if (verification.differing.length > 0) {
            console.log(
              `  differing: ${verification.differing.slice(0, 5).join(', ')}`,
            );
          }
        }
        entryPath = source.entryPath;
        vendoredFiles = source.files;
        moduleCount = source.modules.length;
        externals = source.externals;
        provenance = source.vendoredFrom as unknown as Record<string, unknown>;
        deckName = values.name ?? deckNameForNpm(source.pkg.name);
        deckVersion = values.version ?? source.pkg.version;
        console.log(
          `vendored ${moduleCount} modules from ${source.pkg.name}@${source.pkg.version} (entry ${entryPath}${source.rewritten.length ? `, ${source.rewritten.length} rewritten` : ', 0 rewritten — byte-identical to what npm published'})`,
        );
      } else {
        let result = await vendorFromCdn({
          entryUrl: url,
          allowExternal: values['allow-external'],
          allowHosts: values['allow-host'],
        });
        entryPath = result.entryPath;
        vendoredFiles = result.files;
        moduleCount = result.modules.length;
        externals = result.externals;
        provenance = url;
        deckName = values.name!;
        deckVersion = values.version!;
        console.log(`vendored ${moduleCount} modules from ${url}`);
      }

      let bytes = pack([
        {
          path: 'importmap.json',
          bytes: vendorImportMap(
            deckName,
            deckVersion,
            entryPath,
            provenance,
          ),
        },
        ...vendoredFiles,
      ]);
      let packlist = peekPacklist(bytes);
      console.log(`  treeHash ${packlist.treeHash.hash}`);
      if (externals.length > 0) {
        console.log(
          `  warning: ${externals.length} reference(s) still point outside the pack:`,
        );
        for (let external of externals.slice(0, 5)) {
          console.log(`    ${external}`);
        }
      }
      if (values.realm && values.publisher) {
        let realmDir = resolve(values.realm);
        await publishToStore(
          storeDirFor(realmDir),
          `${values.publisher}/${deckName}`,
          deckVersion,
          bytes,
          { tag: values.tag },
        );
        console.log(
          `published ${values.publisher}/${deckName}@${deckVersion}${values.tag ? ` tag ${values.tag}` : ''} — import it as /${basename(realmDir)}/${values.publisher}/${deckName}@${deckVersion}/`,
        );
      }
      if (values.output || !values.realm) {
        let output = values.output ?? `${deckName}-${deckVersion}.pack.zip`;
        await writeFile(output, bytes);
        console.log(`wrote ${output}`);
      }
      return;
    }
    case 'vendor-tree': {
      let { values, positionals } = parseArgs({
        args: rest,
        allowPositionals: true,
        options: {
          realm: { type: 'string' },
          publisher: { type: 'string' },
          tag: { type: 'string' },
          'minimum-release-age': { type: 'string' },
          'min-age-days': { type: 'string' },
          'max-depth': { type: 'string' },
          'allow-external': { type: 'boolean', default: false },
          'dry-run': { type: 'boolean', default: false },
        },
      });
      let [target] = positionals;
      if (!target || !values.realm || !values.publisher) {
        fail(
          'usage: deck vendor-tree npm:<pkg>[@<range>] --realm <dir> --publisher <p> [--min-age <days>] [--allow-external]',
        );
      }
      if (!target.startsWith('npm:')) {
        fail('vendor-tree takes an npm: spec — the tarball is what carries a module tree');
      }
      let realmDir = resolve(values.realm!);
      let policy = {
        ...(await readRealmPolicy(realmDir)),
        ...cooldownOverride(values),
      };
      let plan = await planVendorTree({
        spec: target.slice(4),
        publisher: values.publisher!,
        storeDir: storeDirFor(realmDir),
        policy,
        maxDepth: values['max-depth'] ? Number(values['max-depth']) : undefined,
        allowExternal: values['allow-external'],
      });
      for (let unit of plan.units) {
        let dependencyNote = Object.entries(unit.dependencies)
          .map(([specifier, value]) => `${specifier}→${value}`)
          .join(' ');
        console.log(
          `${'  '.repeat(unit.depth)}${unit.deck}@${unit.version}  ${unit.modules} modules${dependencyNote ? `  [${dependencyNote}]` : ''}`,
        );
      }
      for (let miss of plan.bundleOnly) {
        console.log(
          `  skipped ${miss.npmName} (needed by ${miss.from}): ${miss.detail}`,
        );
      }
      for (let miss of plan.unresolvable) {
        console.log(`  unresolved ${miss.specifier} in ${miss.from}: ${miss.reason}`);
      }
      if (values['dry-run']) {
        console.log('\ndry run — nothing written');
        return;
      }
      for (let unit of plan.units) {
        let bytes = pack([
          { path: 'importmap.json', bytes: vendorUnitImportMap(unit) },
          ...unit.files,
        ]);
        let name = unit.deck.split('/').at(-1)!;
        try {
          await publishToStore(
            storeDirFor(realmDir),
            unit.deck,
            unit.version,
            bytes,
            { tag: unit.depth === 0 ? values.tag : undefined },
          );
          console.log(
            `published ${unit.deck}@${unit.version} (${peekPacklist(bytes).treeHash.hash.slice(0, 12)})`,
          );
        } catch (error) {
          // An already-published identical version is the dedupe case, not
          // an error: two consumers wanting the same dependency is normal.
          if (String(error).includes('already published')) {
            console.log(`reused ${unit.deck}@${unit.version}`);
          } else {
            throw error;
          }
        }
        void name;
      }
      console.log(
        `\n${plan.units.length} deck(s) under /${basename(realmDir)}/${values.publisher}/`,
      );
      return;
    }
    case 'store': {
      let { values, positionals } = parseArgs({
        args: rest,
        allowPositionals: true,
        options: {
          realm: { type: 'string' },
          'dry-run': { type: 'boolean', default: false },
          'keep-archives': { type: 'boolean', default: false },
        },
      });
      let [subcommand] = positionals;
      if (!values.realm || !subcommand) {
        fail('usage: deck store <status|migrate|gc> --realm <dir> [--dry-run]');
      }
      let storeDir = storeDirFor(resolve(values.realm!));
      if (subcommand === 'status') {
        let report = await inspectStore(storeDir);
        console.log(`packages   ${report.packages}`);
        console.log(`versions   ${report.versions}`);
        console.log(`trees      ${report.trees} (${report.liveTrees} live, ${report.reclaimableTrees} reclaimable)`);
        console.log(`objects    ${report.objects}`);
        console.log(`on disk    ${(report.bytes / 1024).toFixed(0)} KB of objects`);
        if (report.legacyArchives > 0) {
          console.log(
            `legacy     ${report.legacyArchives} version(s) still on pack-v1 — \`deck store migrate\` converts them`,
          );
        }
        return;
      }
      if (subcommand === 'migrate') {
        let result = await migrateStore(storeDir, {
          dryRun: values['dry-run'],
          removeArchives: !values['keep-archives'],
        });
        for (let entry of result.migrated) {
          console.log(
            `  ${values['dry-run'] ? 'would migrate' : 'migrated'} ${entry.name}@${entry.version} (${entry.treeHash.slice(0, 12)})`,
          );
        }
        for (let failure of result.failures) {
          console.log(
            `  FAILED ${failure.name}@${failure.version}: ${failure.detail} — the archive was left alone`,
          );
        }
        console.log(
          `${result.migrated.length} migrated, ${result.alreadyBlobs} already per-file, ${result.archivesRemoved.length} archive(s) removed (${(result.bytesReclaimed / 1024).toFixed(0)} KB)`,
        );
        if (result.failures.length > 0) {
          fail(`${result.failures.length} version(s) could not be migrated`);
        }
        return;
      }
      if (subcommand === 'gc') {
        if (values['dry-run']) {
          let report = await inspectStore(storeDir);
          console.log(
            `${report.reclaimableTrees} tree(s) reclaimable of ${report.trees}; run without --dry-run to collect`,
          );
          return;
        }
        let result = await collectStoreGarbage(storeDir);
        console.log(
          `collected ${result.treesDeleted} tree(s) and ${result.objectsDeleted} object(s), freeing ${(result.bytesFreed / 1024).toFixed(0)} KB`,
        );
        return;
      }
      fail(`unknown store subcommand "${subcommand}" (status | migrate | gc)`);
      return;
    }
    case 'derive': {
      let { values } = parseArgs({
        args: rest,
        options: {
          realm: { type: 'string' },
          publisher: { type: 'string' },
          name: { type: 'string' },
          version: { type: 'string' },
          minify: { type: 'boolean', default: true },
        },
      });
      if (!values.realm || !values.publisher || !values.name || !values.version) {
        fail(
          'usage: deck derive --realm <dir> --publisher <p> --name <n> --version <v> [--minify]',
        );
      }
      await deriveMinifiedRelease(
        storeDirFor(resolve(values.realm!)),
        `${values.publisher}/${values.name}`,
        values.version!,
      );
      return;
    }
    case 'verify-derivation': {
      let { values } = parseArgs({
        args: rest,
        options: {
          realm: { type: 'string' },
          publisher: { type: 'string' },
          name: { type: 'string' },
          version: { type: 'string' },
        },
      });
      if (!values.realm || !values.publisher || !values.name || !values.version) {
        fail(
          'usage: deck verify-derivation --realm <dir> --publisher <p> --name <n> --version <v>',
        );
      }
      let storeDir = storeDirFor(resolve(values.realm!));
      let scoped = `${values.publisher}/${values.name}`;
      let meta = await readStoreMeta(storeDir, scoped);
      let record = meta?.versions[values.version!];
      if (!record) {
        fail(`${scoped}@${values.version} is not a published version`);
      }
      let derivedPackBytes = await readStoredPack(
        storeDir,
        scoped,
        values.version!,
      );
      let mapText = derivedPackBytes
        ? readZipEntry(derivedPackBytes, 'importmap.json')?.toString('utf8')
        : undefined;
      let { derivedFrom, derivation } = mapText
        ? derivationFromMap(mapText, scoped)
        : {};
      if (!derivedFrom || !derivation) {
        fail(
          `${scoped}@${values.version} records no derivation — it is a source tree, not a derived one`,
        );
      }
      // Find which published version holds the source tree it claims.
      let sourceVersion = Object.entries(meta!.versions).find(
        ([, candidate]) => candidate.treeHash === derivedFrom,
      )?.[0];
      if (!sourceVersion) {
        fail(
          `L11: ${scoped}@${values.version} claims derivedFrom ${derivedFrom!.slice(0, 12)}, which no published version holds`,
        );
      }
      let sourcePack = await readStoredPack(storeDir, scoped, sourceVersion!);
      let tool = await terserVersion();
      let verdict = await verifyDerivation({
        sourcePack: sourcePack!,
        derivedTreeHash: record!.treeHash,
        derivation: derivation!,
        sourceVersion: sourceVersion!,
        packageName: scoped,
        version: values.version!,
        terserVersion: tool,
      });
      console.log(
        `${scoped}@${values.version} ← ${sourceVersion} via ${derivation!.tool}`,
      );
      if (verdict.ok) {
        console.log(
          `  ok  re-running the derivation reproduced ${verdict.expected.slice(0, 12)}`,
        );
        return;
      }
      console.log(`  expected ${verdict.expected}`);
      console.log(`  actual   ${verdict.actual ?? '(not produced)'}`);
      fail(`L11: ${verdict.detail ?? 'the derivation did not reproduce'}`);
      return;
    }
    case 'verify-links': {
      let { values } = parseArgs({
        args: rest,
        options: {
          realm: { type: 'string' },
          publisher: { type: 'string' },
          name: { type: 'string' },
          'require-signature': { type: 'string' },
        },
      });
      if (!values.realm) {
        fail('usage: deck verify-links --realm <dir> [--publisher <p> --name <n>]');
      }
      let realmDir = resolve(values.realm!);
      let realmName = basename(realmDir);
      let storeDir = storeDirFor(realmDir);
      let decks = await discoverDecks(realmDir);
      let selected =
        values.publisher && values.name
          ? decks.filter(
              (candidate) =>
                candidate.publisher === values.publisher &&
                candidate.package === values.name,
            )
          : decks;
      if (selected.length === 0) {
        fail('no matching deck in this realm');
      }
      let broken = 0;
      for (let candidate of selected) {
        let report = await verifyLinks({
          realmName,
          storeDir,
          deck: candidate.name,
          deckDir: candidate.dir,
          ...(values['require-signature']
            ? { requireSignatures: Number(values['require-signature']) }
            : {}),
        });
        if (report.findings.length === 0) {
          console.log(`  ok  ${report.deck}  ${report.checked} link(s)`);
          continue;
        }
        broken++;
        console.log(`FAIL  ${report.deck}`);
        for (let finding of report.findings) {
          console.log(`        ${finding.code}  ${finding.specifier}: ${finding.detail}`);
        }
      }
      if (broken > 0) {
        fail(`L11: ${broken} deck(s) with unverifiable links`);
      }
      console.log(`${selected.length} deck(s) verified`);
      return;
    }
    case 'keygen': {
      let { values } = parseArgs({
        args: rest,
        options: { label: { type: 'string' }, list: { type: 'boolean', default: false } },
      });
      if (values.list) {
        let keys = await listKeys();
        if (keys.length === 0) {
          console.log('no keys yet — run `deck keygen`');
        }
        for (let key of keys) {
          console.log(key.keyId);
        }
        return;
      }
      let key = await createKey({ label: values.label });
      console.log(`created ${key.keyId}`);
      console.log(
        '  the private key never leaves this machine; the public key travels inside each signature',
      );
      return;
    }
    case 'sign': {
      let { values } = parseArgs({
        args: rest,
        options: {
          realm: { type: 'string' },
          publisher: { type: 'string' },
          name: { type: 'string' },
          version: { type: 'string' },
          key: { type: 'string' },
          role: { type: 'string' },
        },
      });
      if (!values.realm || !values.publisher || !values.name || !values.version) {
        fail(
          'usage: deck sign --realm <dir> --publisher <p> --name <n> --version <v> [--key <id>] [--role publish|dev]',
        );
      }
      let realmDir = resolve(values.realm!);
      let storeDir = storeDirFor(realmDir);
      let deck = `${values.publisher}/${values.name}`;
      let meta = await readStoreMeta(storeDir, deck);
      let record = meta?.versions[values.version!];
      if (!record) {
        fail(`${deck}@${values.version} is not a published version`);
      }
      let role = (values.role ?? 'publish') as 'publish' | 'dev' | 'attest';
      if (!['publish', 'dev', 'attest'].includes(role)) {
        fail(`--role must be publish, dev or attest`);
      }
      let key = await resolveKey({ keyId: values.key });
      let envelope = await appendSignature(
        storeDir,
        record!.treeHash,
        signTreeHash({
          treeHash: record!.treeHash,
          key,
          role,
          publisher: values.publisher,
          createdAt: new Date().toISOString(),
        }),
      );
      console.log(
        `signed ${deck}@${values.version} (${record!.treeHash.slice(0, 12)}) as ${key.keyId} [${role}]`,
      );
      console.log(
        `  ${envelope.signatures.length} endorsement(s) on this tree — every deck with these bytes has them`,
      );
      return;
    }
    case 'verify-sig': {
      let { values } = parseArgs({
        args: rest,
        options: {
          realm: { type: 'string' },
          'tree-hash': { type: 'string' },
          publisher: { type: 'string' },
          name: { type: 'string' },
          version: { type: 'string' },
          require: { type: 'string' },
        },
      });
      if (!values.realm) {
        fail('usage: deck verify-sig --realm <dir> [--tree-hash <hex> | --publisher <p> --name <n> --version <v>] [--require <n>]');
      }
      let storeDir = storeDirFor(resolve(values.realm!));
      let treeHash = values['tree-hash'];
      if (!treeHash) {
        if (!values.publisher || !values.name || !values.version) {
          fail('give --tree-hash, or --publisher/--name/--version');
        }
        let meta = await readStoreMeta(
          storeDir,
          `${values.publisher}/${values.name}`,
        );
        treeHash = meta?.versions[values.version!]?.treeHash;
        if (!treeHash) {
          fail(
            `${values.publisher}/${values.name}@${values.version} is not a published version`,
          );
        }
      }
      let envelope = await readEnvelope(storeDir, treeHash!);
      let verdict = envelope
        ? verifyEnvelope(treeHash!, envelope)
        : { valid: [], invalid: [], mismatched: false };
      for (let signature of verdict.valid) {
        console.log(`  ok    ${signature.keyId} [${signature.role}]`);
      }
      for (let signature of verdict.invalid) {
        console.log(`  BAD   ${signature.keyId} [${signature.role}]`);
      }
      console.log(
        `${verdict.valid.length} valid, ${verdict.invalid.length} invalid on ${treeHash!.slice(0, 12)}`,
      );
      let required = values.require ? Number(values.require) : 0;
      if (verdict.valid.length < required) {
        fail(
          `L9: ${verdict.valid.length} valid endorsement(s), ${required} required`,
        );
      }
      if (verdict.invalid.length > 0) {
        process.exitCode = 1;
      }
      return;
    }
    case 'conform': {
      let { values } = parseArgs({
        args: rest,
        options: {
          url: { type: 'string' },
          realm: { type: 'string' },
          'at-rest': { type: 'boolean', default: false },
          http: { type: 'boolean', default: false },
          json: { type: 'boolean', default: false },
        },
      });
      // Neither flag means both halves; either means only that half.
      let both = !values['at-rest'] && !values.http;
      let report = await runConformance({
        atRest: both || values['at-rest'],
        http: both || values.http,
        ...(values.url
          ? {
              target: {
                baseUrl: values.url,
                realm: values.realm ?? 'conformance',
              },
            }
          : {}),
      });
      if (values.json) {
        console.log(JSON.stringify(report, null, 2));
      } else {
        console.log(formatReport(report));
      }
      if (report.failed > 0) {
        process.exitCode = 1;
      }
      return;
    }
    case 'prune': {
      let { values } = parseArgs({
        args: rest,
        options: {
          realm: { type: 'string' },
          publisher: { type: 'string' },
          name: { type: 'string' },
          keep: { type: 'string', default: '10' },
        },
      });
      if (!values.realm || !values.publisher || !values.name) {
        fail(
          'usage: deck prune --realm <dir> --publisher <p> --name <n> [--keep <k>]',
        );
      }
      let { removedVersions, deletedFiles } = await pruneDevVersions(
        storeDirFor(resolve(values.realm)),
        `${values.publisher}/${values.name}`,
        { keep: Number(values.keep) },
      );
      console.log(
        `pruned ${removedVersions.length} dev prerelease(s), deleted ${deletedFiles.length} pack file(s)${
          removedVersions.length > deletedFiles.length
            ? ' (the rest are still referenced by surviving versions)'
            : ''
        }`,
      );
      return;
    }
    case 'offers':
    case 'rebase': {
      let { values } = parseArgs({
        args: rest,
        options: {
          realm: { type: 'string' },
          onto: { type: 'string' },
          check: { type: 'boolean', default: false },
          json: { type: 'boolean', default: false },
        },
      });
      if (!values.realm) {
        fail(`usage: deck ${command} --realm <dir> [--onto <spec>]`);
      }
      let realmDir = resolve(values.realm);
      // `offers` reports; `rebase` writes unless asked not to.
      let dryRun = command === 'offers' || values.check;
      let result = await rebasePass({
        realm: {
          name: basename(realmDir),
          dir: realmDir,
          storeDir: storeDirFor(realmDir),
        },
        onto: values.onto,
        dryRun,
        onError: (error) => console.error(`  ${error}`),
      });
      if (values.json) {
        console.log(JSON.stringify(result, null, 2));
        return;
      }
      if (result.outcomes.length === 0) {
        console.log('no open offers (no deck in this realm records a base)');
        return;
      }
      for (let outcome of result.outcomes) {
        let target = outcome.upstreamVersion
          ? `${outcome.upstream}@${outcome.upstreamVersion}`
          : outcome.upstream;
        let note =
          outcome.state === 'conflicted'
            ? `  conflicts: ${outcome.conflicts.join(', ')}`
            : outcome.detail
              ? `  ${outcome.detail}`
              : outcome.applied
                ? '  (written)'
                : '';
        console.log(
          `${outcome.state.padEnd(12)} ${outcome.offer} ← ${target}${note}`,
        );
      }
      console.log(
        dryRun
          ? `${result.outcomes.length} open, ${result.conflicted} need a person`
          : `${result.rebased} rebased, ${result.conflicted} need a person`,
      );
      if (dryRun && values.check && result.conflicted > 0) {
        process.exit(1);
      }
      return;
    }
    case 'fork': {
      let { values } = parseArgs({
        args: rest,
        options: {
          realm: { type: 'string' },
          from: { type: 'string' },
          as: { type: 'string' },
          'use-in': { type: 'string' },
          force: { type: 'boolean', default: false },
        },
      });
      if (!values.realm || !values.from || !values.as) {
        fail(
          'usage: deck fork --realm <dir> --from <pub>/<pkg>[@<version>] --as <pub>/<pkg> [--use-in <pub>/<pkg>]',
        );
      }
      let realmDir = resolve(values.realm);
      let [fromName, fromSpec] = values.from.split('@');
      let [fromPublisher, fromPackage] = fromName.split('/');
      let [toPublisher, toPackage] = values.as.split('/');
      if (!fromPublisher || !fromPackage || !toPublisher || !toPackage) {
        fail('--from and --as are <publisher>/<package>');
      }
      let result = await forkDeck({
        realmDir,
        storeDir: storeDirFor(realmDir),
        from: {
          publisher: fromPublisher,
          package: fromPackage,
          spec: fromSpec,
        },
        to: { publisher: toPublisher, package: toPackage },
        force: values.force,
      });
      console.log(
        `forked ${result.from} → ${result.to} (${result.files.length} files) at ${result.dir}`,
      );
      console.log(
        `  it publishes under ${result.to}; ${fromName}'s versions never move`,
      );
      if (values['use-in']) {
        let [usePublisher, usePackage] = values['use-in'].split('/');
        if (!usePublisher || !usePackage) {
          fail('--use-in is <publisher>/<package>');
        }
        let mapPath = join(realmDir, usePublisher, usePackage, 'importmap.json');
        let map = JSON.parse(await readFile(mapPath, 'utf8'));
        let vendor = (map.deck ??= {});
        let dependencies = (vendor.dependencies ??= {}) as Record<
          string,
          string
        >;
        // ALIAS, not rename: the key stays the import specifier the
        // consumer already writes, and the value says the fork answers to
        // it. Renaming the key would make every `import … from '<base>'` in
        // the consumer's own source wrong, which is the friction a fork is
        // supposed to remove.
        //
        // The entry to repoint is found by what it TARGETS, not by its key:
        // a vendored library is usually already aliased (`"leaflet":
        // "lib/leaflet@1.9.4"`), and matching on the key alone would add a
        // second, unused `lib/leaflet` entry and leave `leaflet` pointing
        // at the original.
        let existingKey = Object.entries(dependencies).find(
          ([key, value]) =>
            key === fromName || parseDependencyValue(value).target === fromName,
        )?.[0];
        // `live` on purpose: the point of a fork is to see every save.
        dependencies[existingKey ?? fromName] = `${result.to}@live`;
        await writeFile(mapPath, JSON.stringify(map, null, 2) + '\n');
        let locked = await lockDeck({
          realmDir,
          realmName: basename(realmDir),
          storeDir: storeDirFor(realmDir),
          deckDir: join(realmDir, usePublisher, usePackage),
        });
        await writeFile(mapPath, locked.text);
        console.log(
          `  ${values['use-in']} now gets ${result.to} live wherever it imports ${fromName} — every save, no publish`,
        );
      }
      return;
    }
    case 'lock': {
      let { values } = parseArgs({
        args: rest,
        options: {
          realm: { type: 'string' },
          publisher: { type: 'string' },
          name: { type: 'string' },
          check: { type: 'boolean', default: false },
        },
      });
      if (!values.realm || !values.publisher || !values.name) {
        fail(
          'usage: deck lock --realm <dir> --publisher <p> --name <n> [--check]',
        );
      }
      let realmDir = resolve(values.realm);
      let { resolutions, text, changed } = await lockDeck({
        realmDir,
        realmName: basename(realmDir),
        storeDir: storeDirFor(realmDir),
        deckDir: join(realmDir, values.publisher, values.name),
      });
      if (resolutions.length === 0) {
        console.log('no dependencies declared (deck.dependencies is empty)');
        return;
      }
      for (let resolution of resolutions) {
        let target = resolution.imports[resolution.key] ?? resolution.imports[`${resolution.key}/`];
        let moved =
          resolution.previous && resolution.previous !== target
            ? `  (was ${resolution.previous})`
            : '';
        console.log(
          `${resolution.key}  ${resolution.alias ? `${resolution.alias}@` : ''}${resolution.spec} → ${target}${moved}`,
        );
      }
      // L11: --check is the gate. A lock that is merely up to date is not
      // enough — the pins must still resolve to files that exist, or CI is
      // green while the app 404s.
      if (values.check) {
        let report = await verifyLinks({
          realmName: basename(realmDir),
          storeDir: storeDirFor(realmDir),
          deck: `${values.publisher}/${values.name}`,
          deckDir: join(realmDir, values.publisher!, values.name!),
        });
        if (changed) {
          report.findings.push({
            code: 'link-integrity',
            specifier: `${values.publisher}/${values.name}`,
            detail: 'the lock is out of date (run without --check to write it)',
          });
        }
        assertLinksOk(report);
        console.log(`verified ${report.checked} link(s)`);
        return;
      }
      if (!changed) {
        console.log('already locked — nothing to write');
        return;
      }
      // Writing the pins is an ordinary edit: it auto-publishes, seals, and
      // reverts like any other save.
      await writeFile(
        join(realmDir, values.publisher, values.name, 'importmap.json'),
        text,
      );
      console.log(`locked ${values.publisher}/${values.name}`);
      return;
    }
    case 'history': {
      let { values, positionals } = parseArgs({
        args: rest,
        allowPositionals: true,
        options: {
          limit: { type: 'string', default: '20' },
          json: { type: 'boolean', default: false },
          history: { type: 'string', default: 'auto' },
        },
      });
      let [dir] = positionals;
      if (!dir) fail('usage: deck history <dir> [--limit <n>] [--json]');
      if (!isValidHistoryKind(values.history!)) {
        fail('--history must be auto, jj, historyd, or none');
      }
      let attachment = await createHistory({
        dir: resolve(dir),
        kind: values.history,
      });
      if (!attachment.backend) {
        fail(`${attachment.detail} — no seals to list`);
      }
      // Listing flushes first, so whatever is on disk right now is sealed
      // before it is reported: the log is never behind the tree.
      let seals = await attachment.backend.list(resolve(dir));
      attachment.backend.close();
      if (values.json) {
        console.log(JSON.stringify(seals, null, 2));
        return;
      }
      if (seals.length === 0) {
        console.log('no seals yet — save a file');
        return;
      }
      for (let seal of seals.slice(0, Number(values.limit))) {
        console.log(
          `${seal.changeId.slice(0, 12)}  ${seal.timestamp}  ${seal.description}${
            seal.author ? ` (${seal.author})` : ''
          }`,
        );
        for (let line of seal.filesSummary) {
          console.log(`              ${line}`);
        }
      }
      if (seals.length > Number(values.limit)) {
        console.log(`… ${seals.length - Number(values.limit)} more`);
      }
      return;
    }
    case 'restore': {
      let { values, positionals } = parseArgs({
        args: rest,
        allowPositionals: true,
        options: { history: { type: 'string', default: 'auto' } },
      });
      let [dir, changeId] = positionals;
      if (!dir || !changeId) fail('usage: deck restore <dir> <changeId>');
      if (!isValidHistoryKind(values.history!)) {
        fail('--history must be auto, jj, historyd, or none');
      }
      let attachment = await createHistory({
        dir: resolve(dir),
        kind: values.history,
      });
      if (!attachment.backend) {
        fail(`${attachment.detail} — nothing to restore from`);
      }
      let result = await applyRestore(
        attachment.backend,
        resolve(dir),
        changeId,
      );
      attachment.backend.close();
      console.log(
        `restored ${dir} to ${changeId}: ${result.written.length} file(s) written, ${result.deleted.length} removed`,
      );
      for (let path of [...result.written, ...result.deleted].slice(0, 10)) {
        console.log(`  ${path}`);
      }
      if (result.from) {
        console.log(
          `the state you left is sealed as ${result.from.slice(0, 12)} — restore it back any time`,
        );
      }
      return;
    }
    case 'hello': {
      // The runme: scaffold a working realm and serve it live in one
      // command. No install, no build, no config — edit a file, reload,
      // see it. Everything else in this CLI is a step you take later.
      let { values, positionals } = parseArgs({
        args: rest,
        allowPositionals: true,
        options: {
          port: { type: 'string', default: DEFAULT_PORT },
          publisher: { type: 'string', default: 'you' },
        },
      });
      // The layout IS the addressing: <root>/<realm>/<publisher>/<package>
      let root = resolve(positionals[0] ?? 'hello-deck');
      let realmName = 'hello';
      let publisher = values.publisher!;
      let name = 'app';
      let realmDir = join(root, realmName);
      let appDir = join(realmDir, publisher, name);
      let exists = await stat(join(appDir, 'app.js')).then(
        () => true,
        () => false,
      );
      if (!exists) {
        await mkdir(appDir, { recursive: true });
        await writeFile(
          join(appDir, 'importmap.json'),
          JSON.stringify(
            {
              imports: {},
              deck: {
                packages: {
                  [name]: { version: '0.1.0', entry: '$REALM/app.js' },
                },
              },
            },
            null,
            2,
          ) + '\n',
        );
        await writeFile(
          join(appDir, 'index.html'),
          `<!doctype html>
<meta charset="utf-8" />
<title>${realmName}/${publisher}/${name}</title>
<script type="module" src="/_live/hmr.js"></script>
<body style="font-family: system-ui; display: grid; place-items: center; height: 100vh; margin: 0">
  <canvas id="c" width="360" height="360"></canvas>
  <script type="module" src="./app.js"></script>
</body>
`,
        );
        await writeFile(
          join(appDir, 'app.js'),
          `// Edit this file and reload the page. That is the whole loop.
const c = document.getElementById('c').getContext('2d');
let t = 0;
setInterval(() => {
  t += 0.02;
  c.fillStyle = '#0b1021';
  c.fillRect(0, 0, 360, 360);
  for (let i = 0; i < 90; i++) {
    const a = i * 0.4 + t;
    const r = 20 + i * 1.6;
    c.fillStyle = \`hsl(\${(i * 4 + t * 60) % 360} 90% 65%)\`;
    c.beginPath();
    c.arc(180 + Math.cos(a) * r, 180 + Math.sin(a) * r, 4, 0, 7);
    c.fill();
  }
}, 16);
`,
        );
      }
      // History is on when the machine can do it: "you cannot lose work" is
      // the promise, and seals are what make it true between publishes.
      let attachment = await createHistory({
        dir: realmDir,
        onError: (error) => console.error(`  history: ${error}`),
      });
      let realm: RealmMount = {
        name: realmName,
        dir: realmDir,
        storeDir: storeDirFor(realmDir),
        history: attachment.backend,
      };
      let server = createDeckServer({ realms: [realm] });
      watchRealm({
        realm,
        onLiveChange: (event) => server.liveBus.emit(event),
        onPublish: ({ name: deck, version }) =>
          console.log(`  saved → ${deck}@${version}`),
        onError: (error) => console.error(`  watch: ${error}`),
      });
      let requested = Number(values.port);
      let port = await listenNear(
        server,
        requested,
        values.port === DEFAULT_PORT ? 10 : 1,
      );
      {
        let url = `http://localhost:${port}/${realmName}/${publisher}/${name}/index.html`;
        console.log(`
  ${exists ? 'Serving' : 'Created'} ${root}

      ${url}

  Open that, then edit ${join(appDir, 'app.js')} — it hot-reloads.

  The URL is the directory: /${realmName}/${publisher}/${name}/app.js IS
  ${realmName}/${publisher}/${name}/app.js on disk. Add @<version> to the
  package segment and you get the sealed copy instead of the live one.

  No npm. No GitHub. No deploy. No PR. Instant feedback.
  Every save is auto-saved as an immutable version — you cannot lose work,
  and you can go back to any of them.

  ${attachment.detail}${
    attachment.backend
      ? `
    deck history ${realmDir}            # every state this realm has been in
    deck restore ${realmDir} <changeId> # go back to any of them`
      : ''
  }

  Next, when you want it:
    deck vendor https://esm.sh/three@0.160.0 --name three --version 0.160.0 \\
      --realm ${realmDir} --publisher ${publisher} --tag latest
    deck release --realm ${realmDir} --publisher ${publisher} --name ${name} \\
      --version 1.0.0 --from dev --tag latest
    deck pack ${appDir}                 # the whole deck as one shareable file
`);
      }
      return;
    }
    case 'serve': {
      let { values } = parseArgs({
        args: rest,
        options: {
          root: { type: 'string' },
          realm: { type: 'string', multiple: true, default: [] },
          as: { type: 'string', multiple: true, default: [] },
          port: { type: 'string', default: DEFAULT_PORT },
          history: { type: 'string', default: 'auto' },
          rebase: { type: 'boolean', default: false },
          onto: { type: 'string' },
        },
      });
      if (!values.root && values.realm!.length === 0) {
        fail(
          'usage: deck serve --root <dir> | --realm <dir> --as <name> [--port <p>] [--history <kind>]',
        );
      }
      if (values.realm!.length !== values.as!.length) {
        fail('each --realm <dir> needs a matching --as <name>');
      }
      if (!isValidHistoryKind(values.history!)) {
        fail(`--history must be auto, jj, historyd, or none`);
      }
      // A root is a directory OF realms — every child directory is one,
      // named after itself, exactly as it is addressed.
      let mounts: { name: string; dir: string }[] = [];
      if (values.root) {
        let rootDir = resolve(values.root);
        for (let entry of await readdir(rootDir, { withFileTypes: true })) {
          if (entry.isDirectory() && !entry.name.startsWith('.')) {
            mounts.push({ name: entry.name, dir: join(rootDir, entry.name) });
          }
        }
      }
      for (let [i, dir] of values.realm!.entries()) {
        mounts.push({ name: values.as![i], dir: resolve(dir) });
      }
      let realms: RealmMount[] = [];
      for (let mount of mounts) {
        let attachment = await createHistory({
          dir: mount.dir,
          kind: values.history,
          onError: (error) => console.error(`history ${mount.name}: ${error}`),
        });
        console.log(`  ${mount.name}: ${attachment.detail}`);
        realms.push({
          name: mount.name,
          dir: mount.dir,
          storeDir: storeDirFor(mount.dir),
          history: attachment.backend,
        });
      }
      let server = createDeckServer({ realms });
      if (values.rebase) {
        for (let realm of realms) {
          startRebaseDaemon({
            realm,
            onto: values.onto,
            onPass: ({ rebased, conflicted }) => {
              if (rebased > 0 || conflicted > 0) {
                console.log(
                  `rebase ${realm.name}: ${rebased} moved, ${conflicted} need a person`,
                );
              }
            },
            onError: (error) => console.error(`rebase ${realm.name}: ${error}`),
          });
        }
      }
      for (let realm of realms) {
        let controller = watchRealm({
          realm,
          onLiveChange: (event) => server.liveBus.emit(event),
          onPublish: ({ name, version, treeHash, sealChangeId }) =>
            console.log(
              `auto-published ${realm.name}/${name}@${version} (${treeHash.slice(0, 12)})${
                sealChangeId ? ` sealed ${sealChangeId.slice(0, 12)}` : ''
              }`,
            ),
          onDeck: (deck) => console.log(`  watching ${realm.name}/${deck.name}`),
          onError: (error) => console.error(`watch ${realm.name}: ${error}`),
        });
        await controller.rescan();
      }
      let port = Number(values.port);
      server.listen(port, async () => {
        console.log(`deck server on http://localhost:${port} (read-only)`);
        console.log(
          `  browse: http://localhost:${port}/  — realms, packages, versions`,
        );
        console.log(
          `  hmr:  http://localhost:${port}/_live/hmr.js → SSE /_live/events`,
        );
        for (let realm of realms) {
          for (let deck of await discoverDecks(realm.dir)) {
            console.log(
              `  live: http://localhost:${port}/${realm.name}/${deck.name}/ ` +
                `— auto-publishes @<base>-dev.N (tag: dev)`,
            );
          }
          if (realm.history) {
            console.log(
              `  seals: http://localhost:${port}/${realm.name}/_history — every save, published or not`,
            );
          }
        }
      });
      return;
    }
    default:
      console.log(HELP);
      process.exit(command === undefined || command === 'help' ? 0 : 1);
  }
}

main().catch((error: unknown) => {
  fail(String((error as Error)?.message ?? error));
});
