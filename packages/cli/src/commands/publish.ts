// The store: sealed bytes, and the names that point at them.
//
// The one idea underneath all seven commands here is that a version is a
// POINTER (L3). Publishing content the store already holds writes nothing.
// Releasing names an existing sealed state and copies zero bytes. Pruning
// deletes bytes only once nothing points at them. And once a name is
// published it never moves (L4) — there is no unpublish.

import { readFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { readZipEntry } from '@cardstack/deck/canonical-zip';
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
} from '@cardstack/deck/store';
import {
  derivationFromMap,
  deriveMinified,
  derivedPack,
  terserVersion,
  verifyDerivation,
} from '@cardstack/deck/derive';
import { readEnvelope, verifyEnvelope } from '@cardstack/deck/signature';
import { defineCommand, type Command } from '../command.ts';
import { depotAt, fail } from '../support.ts';

// Seal a SECOND tree beside a published version: same source, minified,
// its own treeHash, its own version, its own address, tagged `production`.
// Nothing about the source version changes; a consumer opts in.
export async function deriveMinifiedRelease(
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

const publish = defineCommand({
  name: 'publish',
  group: 'publish',
  summary: "publish a pack into a depot's store under a version",
  usage: [
    'publish <file> --depot <dir> --publisher <p> --name <n> --version <v> [--tag <t>]',
  ],
  detail: `The bytes are verified, then written only if their tree hash is new
to the store. Re-publishing a version that already exists is refused (L4).`,
  async run(argv) {
    let { values, positionals } = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        depot: { type: 'string' },
        publisher: { type: 'string' },
        name: { type: 'string' },
        version: { type: 'string' },
        tag: { type: 'string' },
      },
    });
    let [file] = positionals;
    if (
      !file ||
      !values.depot ||
      !values.publisher ||
      !values.name ||
      !values.version
    ) {
      fail(
        'usage: deck publish <file> --depot <dir> --publisher <p> --name <n> --version <v> [--tag <t>]',
      );
    }
    let scoped = `${values.publisher}/${values.name}`;
    let { treeHash } = await publishToStore(
      depotAt(values.depot!).storeDir,
      scoped,
      values.version!,
      await readFile(file!),
      { tag: values.tag },
    );
    console.log(
      `published ${scoped}@${values.version} (treeHash ${treeHash})${values.tag ? ` tag ${values.tag}` : ''}`,
    );
  },
});

const tag = defineCommand({
  name: 'tag',
  group: 'publish',
  summary: 'move a dist-tag to a published version',
  usage: [
    'tag --depot <dir> --publisher <p> --name <n> --tag <t> --version <v>',
  ],
  detail: `A dist-tag is a mutable name for an immutable state. Semver-shaped
tags are refused, so \`1.2.0\` can never mean two things.`,
  async run(argv) {
    let { values } = parseArgs({
      args: argv,
      options: {
        depot: { type: 'string' },
        publisher: { type: 'string' },
        name: { type: 'string' },
        tag: { type: 'string' },
        version: { type: 'string' },
      },
    });
    if (
      !values.depot ||
      !values.publisher ||
      !values.name ||
      !values.tag ||
      !values.version
    ) {
      fail(
        'usage: deck tag --depot <dir> --publisher <p> --name <n> --tag <t> --version <v>',
      );
    }
    let scoped = `${values.publisher}/${values.name}`;
    await setDistTag(
      depotAt(values.depot!).storeDir,
      scoped,
      values.tag!,
      values.version!,
    );
    console.log(`${scoped} ${values.tag} → ${values.version}`);
  },
});

const release = defineCommand({
  name: 'release',
  group: 'publish',
  summary: 'name an existing sealed state as a new version — never a copy',
  usage: [
    'release --depot <dir> --publisher <p> --name <n> --version <v>',
    '        --from <tag-or-version> [--tag <t>] [--require-signature] [--minify]',
  ],
  detail: `Shipping is a metadata edit. The dev line you have been
auto-publishing all afternoon already holds the bytes; --from names which of
those states becomes 1.1.0, and zero bytes are copied.

--require-signature refuses unless the tree carries a valid publish
endorsement (L9 as policy — off by default so a keyless install is never
bricked). --minify additionally seals a derived, minified tree beside it.`,
  async run(argv) {
    let { values } = parseArgs({
      args: argv,
      options: {
        depot: { type: 'string' },
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
      !values.depot ||
      !values.publisher ||
      !values.name ||
      !values.version ||
      !values.from
    ) {
      fail(
        'usage: deck release --depot <dir> --publisher <p> --name <n> --version <v> --from <tag-or-version> [--tag <t>]',
      );
    }
    let { storeDir } = depotAt(values.depot!);
    let scoped = `${values.publisher}/${values.name}`;
    // A leading digit means a source version; otherwise a dist-tag.
    let from = /^[0-9]/.test(values.from!)
      ? { version: values.from! }
      : { tag: values.from! };
    // L9 as policy: an auto-published dev line may be unsigned, but a
    // stable release is a deliberate human act and can be made to require
    // a deliberate human endorsement. Off by default so a keyless install
    // is never bricked; the release line says which it was.
    if (values['require-signature']) {
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
    let record = await releaseVersion(storeDir, scoped, values.version!, from, {
      tag: values.tag,
    });
    console.log(
      `released ${scoped}@${values.version} from ${values.from}: same sealed state (treeHash ${record.treeHash}), zero bytes copied${values.tag ? `, tag ${values.tag}` : ''}${values['require-signature'] ? ' — endorsed' : ''}`,
    );

    if (values.minify) {
      await deriveMinifiedRelease(storeDir, scoped, values.version!);
    }
  },
});

const prune = defineCommand({
  name: 'prune',
  group: 'publish',
  summary: 'drop old -dev.N prereleases from a package',
  usage: ['prune --depot <dir> --publisher <p> --name <n> [--keep <k>]'],
  detail: `Only dev prereleases are eligible — never a stable, never anything
a dist-tag points at. Bytes are deleted when, and only when, no surviving
version still references them, so pruning a dev line that a release was cut
from frees nothing and breaks nothing.`,
  async run(argv) {
    let { values } = parseArgs({
      args: argv,
      options: {
        depot: { type: 'string' },
        publisher: { type: 'string' },
        name: { type: 'string' },
        keep: { type: 'string', default: '10' },
      },
    });
    if (!values.depot || !values.publisher || !values.name) {
      fail(
        'usage: deck prune --depot <dir> --publisher <p> --name <n> [--keep <k>]',
      );
    }
    let { removedVersions, deletedFiles } = await pruneDevVersions(
      depotAt(values.depot!).storeDir,
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
  },
});

const store = defineCommand({
  name: 'store',
  group: 'publish',
  summary: 'inspect, migrate, or garbage-collect a depot store',
  usage: [
    'store <status|migrate|gc> --depot <dir> [--dry-run] [--keep-archives]',
  ],
  detail: `status: what the store holds and what is reclaimable.

migrate: convert a legacy packs/ store into per-file objects, proving each
rebuild is byte-identical before deleting anything.

gc: drop trees and objects no published version points at.`,
  async run(argv) {
    let { values, positionals } = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        depot: { type: 'string' },
        'dry-run': { type: 'boolean', default: false },
        'keep-archives': { type: 'boolean', default: false },
      },
    });
    let [subcommand] = positionals;
    if (!values.depot || !subcommand) {
      fail('usage: deck store <status|migrate|gc> --depot <dir> [--dry-run]');
    }
    let { storeDir } = depotAt(values.depot!);
    if (subcommand === 'status') {
      let report = await inspectStore(storeDir);
      console.log(`packages   ${report.packages}`);
      console.log(`versions   ${report.versions}`);
      console.log(
        `trees      ${report.trees} (${report.liveTrees} live, ${report.reclaimableTrees} reclaimable)`,
      );
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
  },
});

const derive = defineCommand({
  name: 'derive',
  group: 'publish',
  summary: 'seal a minified tree beside a published version',
  usage: [
    'derive --depot <dir> --publisher <p> --name <n> --version <v> [--minify]',
  ],
  detail: `The derived tree gets its own tree hash, its own version
(<v>-min.0) and its own address, tagged "production". The source version
does not change — minification is a second artifact, never an edit to the
first, and never the identity of anything.`,
  async run(argv) {
    let { values } = parseArgs({
      args: argv,
      options: {
        depot: { type: 'string' },
        publisher: { type: 'string' },
        name: { type: 'string' },
        version: { type: 'string' },
        minify: { type: 'boolean', default: true },
      },
    });
    if (!values.depot || !values.publisher || !values.name || !values.version) {
      fail(
        'usage: deck derive --depot <dir> --publisher <p> --name <n> --version <v> [--minify]',
      );
    }
    await deriveMinifiedRelease(
      depotAt(values.depot!).storeDir,
      `${values.publisher}/${values.name}`,
      values.version!,
    );
  },
});

const verifyDerivationCommand = defineCommand({
  name: 'verify-derivation',
  group: 'publish',
  summary: "re-run a derived tree's recorded derivation and require a match",
  usage: [
    'verify-derivation --depot <dir> --publisher <p> --name <n> --version <v>',
  ],
  detail: `A derivation nobody can reproduce is decoration, so this refuses
rather than warns: the recorded tool is re-run over the recorded source, and
the result must be the same tree hash the derived version was published
under.`,
  async run(argv) {
    let { values } = parseArgs({
      args: argv,
      options: {
        depot: { type: 'string' },
        publisher: { type: 'string' },
        name: { type: 'string' },
        version: { type: 'string' },
      },
    });
    if (!values.depot || !values.publisher || !values.name || !values.version) {
      fail(
        'usage: deck verify-derivation --depot <dir> --publisher <p> --name <n> --version <v>',
      );
    }
    let { storeDir } = depotAt(values.depot!);
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
    let verdict = await verifyDerivation({
      sourcePack: sourcePack!,
      derivedTreeHash: record!.treeHash,
      derivation: derivation!,
      sourceVersion: sourceVersion!,
      packageName: scoped,
      version: values.version!,
      terserVersion: await terserVersion(),
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
  },
});

export const PUBLISH_COMMANDS: Command[] = [
  publish,
  tag,
  release,
  prune,
  store,
  derive,
  verifyDerivationCommand,
];
