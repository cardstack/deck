import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import {
  treeHashFromDir,
  formatTreeHash,
  hashBytes,
} from '@deck/core/tree-hash';
import { packFromDir, peekPacklist, unpack } from '@deck/core/pack';
import { publishToStore, setDistTag } from '@deck/core/store';
import { createDeckServer } from '@deck/server/server';

// The Deck CLI is the WRITE side of the standalone protocol: it arranges
// at-rest state (packs, the store). The server is read-only. Together they
// are the reference implementation any other implementor (the Boxel realm
// server included) must agree with byte-for-byte.

const HELP = `deck — the Deck protocol CLI

Usage:
  deck hash <dir>                       print the canonical tree hash
  deck pack <dir> [--output <file>] [--created-by <who>] [--source <realm>]
                                        create <basename>.pack.zip
  deck unpack <file> [--into <dir>] [--force]
                                        extract a verified pack
  deck list <file>                      show a pack's packlist
  deck verify <file|dir>                verify a pack / hash a directory
  deck publish <file> --store <dir> --name <n> --version <v> [--tag <t>]
                                        publish a pack into a store
  deck tag --store <dir> --name <n> --tag <t> --version <v>
                                        move a dist-tag
  deck serve --store <dir> [--port <p>]
                                        start the read-only Deck server
`;

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
          store: { type: 'string' },
          name: { type: 'string' },
          version: { type: 'string' },
          tag: { type: 'string' },
        },
      });
      let [file] = positionals;
      if (!file || !values.store || !values.name || !values.version) {
        fail(
          'usage: deck publish <file> --store <dir> --name <n> --version <v> [--tag <t>]',
        );
      }
      let { treeHash } = await publishToStore(
        resolve(values.store),
        values.name,
        values.version,
        await readFile(file),
        { tag: values.tag },
      );
      console.log(
        `published ${values.name}@${values.version} (treeHash ${treeHash})${values.tag ? ` tag ${values.tag}` : ''}`,
      );
      return;
    }
    case 'tag': {
      let { values } = parseArgs({
        args: rest,
        options: {
          store: { type: 'string' },
          name: { type: 'string' },
          tag: { type: 'string' },
          version: { type: 'string' },
        },
      });
      if (!values.store || !values.name || !values.tag || !values.version) {
        fail(
          'usage: deck tag --store <dir> --name <n> --tag <t> --version <v>',
        );
      }
      await setDistTag(
        resolve(values.store),
        values.name,
        values.tag,
        values.version,
      );
      console.log(`${values.name} ${values.tag} → ${values.version}`);
      return;
    }
    case 'serve': {
      let { values } = parseArgs({
        args: rest,
        options: {
          store: { type: 'string' },
          port: { type: 'string', default: '8787' },
        },
      });
      if (!values.store) fail('usage: deck serve --store <dir> [--port <p>]');
      let server = createDeckServer({ storeDir: resolve(values.store) });
      let port = Number(values.port);
      server.listen(port, () => {
        console.log(
          `deck server on http://localhost:${port} (read-only, store: ${values.store})`,
        );
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
