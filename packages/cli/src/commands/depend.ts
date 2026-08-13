// Where a deck's imports come from.
//
// Two halves of one question. `vendor` and `vendor-tree` bring foreign code
// IN — from a CDN, from npm's tarball, or from another Deck server — and
// seal it under your own publisher, so what your app loads is bytes you
// hold. `lock` and `verify-links` settle what the specifiers in your own
// tree resolve to, and refuse to let that answer go stale (L7, L11).

import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { pack, peekPacklist } from '@cardstack/deck/pack';
import { publishToStore } from '@cardstack/deck/store';
import { lockDepot, DEPOT_LOCK_PATH } from '@cardstack/deck/lock';
import { assertLinksOk, verifyLinks } from '@cardstack/deck/verify-links';
import {
  vendorFromCdn,
  vendorImportMap,
  vendorPackageJson,
} from '@cardstack/deck/vendor';
import {
  deckNameForNpm,
  probeEntries,
  vendorFromNpmSource,
} from '@cardstack/deck-tools/vendor-npm';
import { fetchNpmPackage, verifyAgainstGithubTree } from '@cardstack/deck-tools/npm';
import { mapVendorImportMap, vendorFromSourceMap } from '@cardstack/deck-tools/vendor-map';
import { planVendorTree, vendorUnitImportMap } from '@cardstack/deck-tools/vendor-tree';
import { discoverDecks } from '@cardstack/deck-server/depot';
import { readDepotPolicy } from '@cardstack/deck-tools/depot-policy';
import { defineCommand, type Command } from '../command.ts';
import { cooldownOverride, depotAt, fail } from '../support.ts';

const vendor = defineCommand({
  name: 'vendor',
  group: 'depend',
  summary: "pull a library's whole module graph in-house and seal it",
  usage: [
    'vendor <url> --name <n> --version <v> [--depot <dir> --publisher <p>]',
    '       [--tag <t>] [--output <file>] [--allow-external] [--allow-host <h>]...',
    'vendor npm:<pkg>@<version> [--entry <path>] [--verify-repo] [--probe]',
    '       [--name <n>] [--version <v>] [--depot <dir> --publisher <p>] [--tag <t>]',
    'vendor npm:<pkg>@<version> --mode map [--entry <path>]',
  ],
  detail: `URL mode walks a module graph from any ESM origin — esm.sh, unpkg,
jsdelivr, or another Deck server — ONCE, rewrites every cross-module
reference to stay inside the pack, and seals it. Your app then imports from
your own server and never touches the public web at runtime. This is your
own unpkg, and it is hermetic by default (L6): if the graph reaches a host
the walker will not follow, the command fails rather than sealing a live
external reference inside a pack. --allow-external keeps it live and
--allow-host follows it too; both are deliberate opt-outs.

SOURCE mode (npm:) vendors the module tree npm published instead of a CDN's
bundle, so every file is a separate address you can fork and edit. --probe
reports what each candidate entry reaches WITHOUT vendoring — a candidate
that reaches exactly 1 module is a bundle, and the boundary was lost at
publish time. --verify-repo checks the tree against the GitHub commit npm
recorded, blob by blob.

MAP mode is for a package that ships only a bundle: the pre-bundle module
tree is recovered from the source map. It is readable and diffable against
upstream, but NOT executable — so the deck declares no entry and nothing can
import it.

Whichever mode, the canonical source travels with the bytes as
\`vendoredFrom\` (L8), so a consumer can always say what a vendored module IS.`,
  async run(argv) {
    let { values, positionals } = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        name: { type: 'string' },
        version: { type: 'string' },
        depot: { type: 'string' },
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
        'usage: deck vendor <url|npm:pkg@version> --name <n> --version <v> [--depot <dir> --publisher <p>] [--output <file>]',
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
        'usage: deck vendor <url> --name <n> --version <v> [--depot <dir> --publisher <p>] [--output <file>]',
      );
    }
    if ((values.depot === undefined) !== (values.publisher === undefined)) {
      fail('publishing a vendored pack needs both --depot and --publisher');
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
      let bytes = pack([
        {
          path: 'importmap.json',
          bytes: mapVendorImportMap(deckName, recovered),
        },
        ...recovered.files.filter((file) => file.path !== 'importmap.json'),
      ]);
      console.log(`  treeHash ${peekPacklist(bytes).treeHash.hash}`);
      if (values.depot && values.publisher) {
        let depot = depotAt(values.depot);
        await publishToStore(
          depot.storeDir,
          `${values.publisher}/${deckName}`,
          deckVersion,
          bytes,
          { tag: values.tag },
        );
        console.log(
          `published ${values.publisher}/${deckName}@${deckVersion} — read it at /${depot.name}/${values.publisher}/${deckName}@${deckVersion}/`,
        );
      }
      if (values.output || !values.depot) {
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

    let files = vendoredFiles.filter((file) => file.path !== 'importmap.json');
    if (!files.some((file) => file.path === 'package.json')) {
      files.push({
        path: 'package.json',
        bytes: vendorPackageJson(deckName, deckVersion, entryPath),
      });
    }
    files.push({
      path: 'importmap.json',
      bytes: vendorImportMap(deckName, provenance),
    });
    let bytes = pack(files);
    console.log(`  treeHash ${peekPacklist(bytes).treeHash.hash}`);
    if (externals.length > 0) {
      console.log(
        `  warning: ${externals.length} reference(s) still point outside the pack:`,
      );
      for (let external of externals.slice(0, 5)) {
        console.log(`    ${external}`);
      }
    }
    if (values.depot && values.publisher) {
      let depot = depotAt(values.depot);
      await publishToStore(
        depot.storeDir,
        `${values.publisher}/${deckName}`,
        deckVersion,
        bytes,
        { tag: values.tag },
      );
      console.log(
        `published ${values.publisher}/${deckName}@${deckVersion}${values.tag ? ` tag ${values.tag}` : ''} — import it as /${depot.name}/${values.publisher}/${deckName}@${deckVersion}/`,
      );
    }
    if (values.output || !values.depot) {
      let output = values.output ?? `${deckName}-${deckVersion}.pack.zip`;
      await writeFile(output, bytes);
      console.log(`wrote ${output}`);
    }
  },
});

const vendorTree = defineCommand({
  name: 'vendor-tree',
  group: 'depend',
  summary: 'vendor a package AND its dependency graph, one deck each',
  usage: [
    'vendor-tree npm:<pkg>[@<range>] --depot <dir> --publisher <p>',
    '            [--minimum-release-age <minutes>] [--min-age-days <days>]',
    '            [--max-depth <n>] [--allow-external] [--dry-run]',
  ],
  detail: `Each package in the graph becomes its own deck, wired to the
others by aliased dependency records rather than by nesting — so a library
two consumers share is stored and loaded ONCE (L7's corollary).

Cooldown is enforced: a version published in the last --min-age-days days
(default 30) is refused, and a range resolves to the newest release that IS
old enough. A brand-new version of a transitive dependency is the shape most
supply-chain attacks arrive in, so waiting is the default rather than a
setting somebody remembers to turn on.

--dry-run prints the plan — every deck, its version, its module count and
its wiring — and writes nothing.`,
  async run(argv) {
    let { values, positionals } = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        depot: { type: 'string' },
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
    if (!target || !values.depot || !values.publisher) {
      fail(
        'usage: deck vendor-tree npm:<pkg>[@<range>] --depot <dir> --publisher <p> [--min-age-days <days>] [--allow-external]',
      );
    }
    if (!target!.startsWith('npm:')) {
      fail(
        'vendor-tree takes an npm: spec — the tarball is what carries a module tree',
      );
    }
    let depot = depotAt(values.depot!);
    let policy = {
      ...(await readDepotPolicy(depot.dir)),
      ...cooldownOverride(values),
    };
    let plan = await planVendorTree({
      spec: target!.slice(4),
      publisher: values.publisher!,
      storeDir: depot.storeDir,
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
      console.log(
        `  unresolved ${miss.specifier} in ${miss.from}: ${miss.reason}`,
      );
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
      try {
        await publishToStore(depot.storeDir, unit.deck, unit.version, bytes, {
          tag: unit.depth === 0 ? values.tag : undefined,
        });
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
    }
    console.log(
      `\n${plan.units.length} deck(s) under /${depot.name}/${values.publisher}/`,
    );
  },
});

const lock = defineCommand({
  name: 'lock',
  group: 'depend',
  summary:
    "write the depot lockfile from every package.json's suggested ranges",
  usage: ['lock --depot <dir> [--update] [--check] [--continuous]'],
  detail: `package.json holds ranges — suggestions. The depot-root
importmap.json is the only authority. \`deck lock\` creates it (newest
version that satisfies each range) or, with --update, refreshes every pin.
Nothing upstream changes what this depot runs until you ask.

A lock that already exists is left alone except for new specifiers, unless
--update is passed. --check is the frozen-lockfile analogue: resolve, refuse
to write, fail if the lock would change.`,
  async run(argv) {
    let { values } = parseArgs({
      args: argv,
      options: {
        depot: { type: 'string' },
        check: { type: 'boolean', default: false },
        update: { type: 'boolean', default: false },
        continuous: { type: 'boolean', default: false },
      },
    });
    if (!values.depot) {
      fail('usage: deck lock --depot <dir> [--update] [--check] [--continuous]');
    }
    let depot = depotAt(values.depot!);

    let { resolutions, text, changed } = await lockDepot({
      depotDir: depot.dir,
      depotName: depot.name,
      storeDir: depot.storeDir,
      update: values.update,
      continuous: values.continuous,
    });
    for (let resolution of resolutions) {
      let target =
        resolution.imports[resolution.key] ??
        resolution.imports[`${resolution.key}/`];
      let moved =
        resolution.previous && resolution.previous !== target
          ? `  (was ${resolution.previous})`
          : '';
      console.log(
        `${resolution.key}  ${resolution.alias ? `${resolution.alias}@` : ''}${resolution.spec} → ${target}${moved}`,
      );
    }
    if (values.check) {
      if (changed) {
        fail('the depot lock is out of date (run without --check to write it)');
      }
      console.log('depot lock is current');
      return;
    }
    if (!changed) {
      console.log('already locked — nothing to write');
      return;
    }
    await writeFile(join(depot.dir, DEPOT_LOCK_PATH), text);
    console.log(`locked depot ${depot.name} → ${DEPOT_LOCK_PATH}`);
  },
});

const verifyLinksCommand = defineCommand({
  name: 'verify-links',
  group: 'depend',
  summary: 'L11: check that every pin still resolves to what it claims',
  usage: [
    'verify-links --depot <dir> [--publisher <p> --name <n>]',
    '             [--require-signature <n>]',
  ],
  detail: `Three things must hold for every deck checked: each pin resolves
to what its dependency record implies, every pin has a record and every
record a pin, and the files those pins name actually exist.

Deliberately OFFLINE. A publish that silently depends on a registry being
reachable is a publish that fails at 3am, so this checks what can be known
locally. A stale lock is a lie about what will be served, so a finding is a
refusal rather than a warning.`,
  async run(argv) {
    let { values } = parseArgs({
      args: argv,
      options: {
        depot: { type: 'string' },
        publisher: { type: 'string' },
        name: { type: 'string' },
        'require-signature': { type: 'string' },
      },
    });
    if (!values.depot) {
      fail(
        'usage: deck verify-links --depot <dir> [--publisher <p> --name <n>]',
      );
    }
    let depot = depotAt(values.depot!);
    let decks = await discoverDecks(depot.dir);
    let selected =
      values.publisher && values.name
        ? decks.filter(
            (candidate) =>
              candidate.publisher === values.publisher &&
              candidate.package === values.name,
          )
        : decks;
    if (selected.length === 0) {
      fail('no matching deck in this depot');
    }
    let broken = 0;
    for (let candidate of selected) {
      let report = await verifyLinks({
        depotName: depot.name,
        storeDir: depot.storeDir,
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
        console.log(
          `        ${finding.code}  ${finding.specifier}: ${finding.detail}`,
        );
      }
    }
    if (broken > 0) {
      fail(`L11: ${broken} deck(s) with unverifiable links`);
    }
    console.log(`${selected.length} deck(s) verified`);
  },
});

export const DEPEND_COMMANDS: Command[] = [
  vendor,
  vendorTree,
  lock,
  verifyLinksCommand,
];
