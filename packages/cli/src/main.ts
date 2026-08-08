import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import {
  treeHashFromDir,
  formatTreeHash,
  hashBytes,
} from '@deck/core/tree-hash';
import { pack, packFromDir, peekPacklist, unpack } from '@deck/core/pack';
import {
  pruneDevVersions,
  publishToStore,
  releaseVersion,
  setDistTag,
} from '@deck/core/store';
import { forkDeck } from '@deck/core/fork';
import { rebasePass, startRebaseDaemon } from '@deck/server/rebase-daemon';
import { lockDeck, parseDependencyValue } from '@deck/core/lock';
import { vendorFromCdn, vendorImportMap } from '@deck/core/vendor';
import {
  deckNameForNpm,
  probeEntries,
  vendorFromNpmSource,
} from '@deck/core/vendor-npm';
import { fetchNpmPackage, verifyAgainstGithubTree } from '@deck/core/npm';
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
import { applyRestore } from '@deck/history/backend';
import { createHistory, isValidHistoryKind } from '@deck/history/create';

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
               --from <tag-or-version> [--tag <t>]
                                        name an existing sealed state as a new
                                        version — a pointer, never a copy
  deck vendor <cdn-url> --name <n> --version <v> [--realm <dir> --publisher <p>]
              [--tag <t>] [--output <file>] [--allow-external] [--allow-host <h>]...
                                        pull a library's whole module graph
                                        from esm.sh/unpkg/jsdelivr ONCE,
                                        rewrite every reference to stay
                                        inside the pack, and seal it — your
                                        own unpkg, hermetic by default
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
      let record = await releaseVersion(
        storeDirFor(resolve(values.realm)),
        scoped,
        values.version,
        from,
        { tag: values.tag },
      );
      console.log(
        `released ${scoped}@${values.version} from ${values.from}: same sealed state (treeHash ${record.treeHash}), zero bytes copied${values.tag ? `, tag ${values.tag}` : ''}`,
      );
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
      if (!changed) {
        console.log('already locked — nothing to write');
        return;
      }
      if (values.check) {
        fail('the lock is out of date (run without --check to write it)');
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
