// Identity and transport — the two at-rest laws, and nothing else.
//
// Everything here works offline against a plain directory or a plain file.
// No depot, no store, no server: L1 (identity is the tree hash) and L2 (a
// pack round-trips faithfully) are checkable with nothing else installed.

import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import {
  formatTreeHash,
  hashBytes,
  treeHashFromDir,
} from '@deck/core/tree-hash';
import { packFromDir, peekPacklist, unpack } from '@deck/core/pack';
import { defineCommand, type Command } from '../command.ts';
import { fail } from '../support.ts';

const hash = defineCommand({
  name: 'hash',
  group: 'seal',
  summary: 'print the canonical tree hash of a directory',
  usage: ['hash <dir>'],
  detail: `L1: identity is tree-hash-v1 over the logical file tree, and
nothing else enters it — not zip framing, not compression, not the order
bytes landed on disk, not the version a human attached. Two directories
with the same files hash the same on every implementation, forever.`,
  async run(argv) {
    let [dir] = argv;
    if (!dir) fail('usage: deck hash <dir>');
    console.log(formatTreeHash(await treeHashFromDir(resolve(dir))));
  },
});

const pack = defineCommand({
  name: 'pack',
  group: 'seal',
  summary: 'create <basename>.pack.zip from a directory',
  usage: [
    'pack <dir> [--output <file>] [--created-by <who>] [--source <depot>]',
  ],
  detail: `A pack is a standard zip any tool can open, plus a packlist that
records the tree hash and every file's own hash. It is transport, not
identity: unpacking it anywhere reproduces the same tree hash (L2).`,
  async run(argv) {
    let { values, positionals } = parseArgs({
      args: argv,
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
    if (values.source) provenance.sourceDepot = values.source;
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
  },
});

const unpackCommand = defineCommand({
  name: 'unpack',
  group: 'seal',
  summary: 'extract a verified pack into a directory',
  usage: ['unpack <file> [--into <dir>] [--force]'],
  detail: `Every file is verified against the packlist before it is written.
A file that already exists with identical content is skipped rather than
rewritten; one that exists with DIFFERENT content stops the unpack, because
silently overwriting somebody's edit is not extraction. --force overwrites.`,
  async run(argv) {
    let { values, positionals } = parseArgs({
      args: argv,
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
  },
});

const list = defineCommand({
  name: 'list',
  group: 'seal',
  summary: "show a pack's packlist — every file, size, and hash",
  usage: ['list <file>'],
  async run(argv) {
    let [file] = argv;
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
  },
});

const verify = defineCommand({
  name: 'verify',
  group: 'seal',
  summary: 'verify a pack, or hash a directory',
  usage: ['verify <file|dir>'],
  detail: `Given a pack, every entry is checked against its recorded hash and
the whole against the tree hash — a tampered byte anywhere is a refusal, not
a warning. Given a directory, it prints what the directory hashes to.`,
  async run(argv) {
    let [target] = argv;
    if (!target) fail('usage: deck verify <file|dir>');
    let stats = await stat(resolve(target));
    if (stats.isDirectory()) {
      console.log(
        `ok: directory, ${formatTreeHash(await treeHashFromDir(resolve(target)))}`,
      );
      return;
    }
    let opened = unpack(await readFile(target));
    console.log(
      `ok: ${opened.files.size} files verified, treeHash ${opened.treeHash}`,
    );
  },
});

export const SEAL_COMMANDS: Command[] = [
  hash,
  pack,
  unpackCommand,
  list,
  verify,
];
