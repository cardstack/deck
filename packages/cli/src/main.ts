import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
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
import { vendorFromCdn, vendorImportMap } from '@deck/core/vendor';
import { createDeckServer } from '@deck/server/server';
import { watchAndPublish } from '@deck/server/watcher';

// The Deck CLI is the WRITE side of the standalone protocol: it arranges
// at-rest state (packs, the store). The server is read-only. Together they
// are the reference implementation any other implementor (the Boxel realm
// server included) must agree with byte-for-byte.

const HELP = `deck — the Deck protocol CLI

Usage:
  deck hello [dir] [--port <p>]         scaffold a live app and serve it — start here
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
  deck release --store <dir> --name <n> --version <v> --from <tag-or-version> [--tag <t>]
                                        name an existing sealed state as a new
                                        version — a pointer, never a copy
  deck vendor <cdn-url> --name <n> --version <v> [--store <dir>] [--tag <t>]
              [--output <file>] [--allow-external] [--allow-host <h>]...
                                        pull a library's whole module graph
                                        from esm.sh/unpkg/jsdelivr ONCE,
                                        rewrite every reference to stay
                                        inside the pack, and seal it — your
                                        own unpkg, hermetic by default
  deck prune --store <dir> --name <n> [--keep <k>]
                                        drop old -dev.N prereleases (never
                                        stables or tag targets); bytes are
                                        deleted only when nothing points at them
  deck serve --store <dir> [--port <p>] [--watch <dir> --as <name>]...
                                        start the read-only Deck server;
                                        --watch adds /live/<name> vibe serving
                                        plus auto-published <base>-dev.N versions
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
    case 'release': {
      let { values } = parseArgs({
        args: rest,
        options: {
          store: { type: 'string' },
          name: { type: 'string' },
          version: { type: 'string' },
          from: { type: 'string' },
          tag: { type: 'string' },
        },
      });
      if (!values.store || !values.name || !values.version || !values.from) {
        fail(
          'usage: deck release --store <dir> --name <n> --version <v> --from <tag-or-version> [--tag <t>]',
        );
      }
      // A leading digit means a source version; otherwise a dist-tag.
      let from = /^[0-9]/.test(values.from)
        ? { version: values.from }
        : { tag: values.from };
      let record = await releaseVersion(
        resolve(values.store),
        values.name,
        values.version,
        from,
        { tag: values.tag },
      );
      console.log(
        `released ${values.name}@${values.version} from ${values.from}: same sealed state (treeHash ${record.treeHash}), zero bytes copied${values.tag ? `, tag ${values.tag}` : ''}`,
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
          store: { type: 'string' },
          tag: { type: 'string' },
          output: { type: 'string' },
          'allow-external': { type: 'boolean', default: false },
          'allow-host': { type: 'string', multiple: true, default: [] },
        },
      });
      let [url] = positionals;
      if (!url || !values.name || !values.version) {
        fail(
          'usage: deck vendor <cdn-url> --name <n> --version <v> [--store <dir>] [--output <file>]',
        );
      }
      let result = await vendorFromCdn({
        entryUrl: url,
        allowExternal: values['allow-external'],
        allowHosts: values['allow-host'],
      });
      let bytes = pack([
        {
          path: 'importmap.json',
          bytes: vendorImportMap(
            values.name,
            values.version,
            result.entryPath,
            url,
          ),
        },
        ...result.files,
      ]);
      let packlist = peekPacklist(bytes);
      console.log(
        `vendored ${result.modules.length} modules from ${url} (treeHash ${packlist.treeHash.hash})`,
      );
      if (result.externals.length > 0) {
        console.log(
          `  warning: ${result.externals.length} reference(s) still point outside the pack:`,
        );
        for (let external of result.externals.slice(0, 5)) {
          console.log(`    ${external}`);
        }
      }
      if (values.store) {
        await publishToStore(
          resolve(values.store),
          values.name,
          values.version,
          bytes,
          { tag: values.tag },
        );
        console.log(
          `published ${values.name}@${values.version}${values.tag ? ` tag ${values.tag}` : ''} — import it as /@${values.name}@${values.version}/`,
        );
      }
      if (values.output || !values.store) {
        let output =
          values.output ?? `${values.name}-${values.version}.pack.zip`;
        await writeFile(output, bytes);
        console.log(`wrote ${output}`);
      }
      return;
    }
    case 'prune': {
      let { values } = parseArgs({
        args: rest,
        options: {
          store: { type: 'string' },
          name: { type: 'string' },
          keep: { type: 'string', default: '10' },
        },
      });
      if (!values.store || !values.name) {
        fail('usage: deck prune --store <dir> --name <n> [--keep <k>]');
      }
      let { removedVersions, deletedFiles } = await pruneDevVersions(
        resolve(values.store),
        values.name,
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
    case 'hello': {
      // The runme: scaffold a working app and serve it live in one
      // command. No install, no build, no config — edit a file, reload,
      // see it. Everything else in this CLI is a step you take later.
      let { values, positionals } = parseArgs({
        args: rest,
        allowPositionals: true,
        options: { port: { type: 'string', default: '8787' } },
      });
      let appDir = resolve(positionals[0] ?? 'hello-deck');
      let name = basename(appDir)
        .replace(/[^a-z0-9-]/gi, '-')
        .toLowerCase();
      let storeDir = `${appDir}-store`; // outside the watched tree, always
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
<title>${name}</title>
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
      watchAndPublish({
        dir: appDir,
        name,
        storeDir,
        onPublish: ({ version }) => console.log(`  saved → ${name}@${version}`),
        onError: (error) => console.error(`  watch: ${error}`),
      });
      let server = createDeckServer({
        storeDir,
        live: { [name]: appDir },
      });
      let port = Number(values.port);
      server.listen(port, () => {
        let url = `http://localhost:${port}/live/${name}/index.html`;
        console.log(`
  ${exists ? 'Serving' : 'Created'} ${appDir}

      ${url}

  Open that, then edit ${join(appDir, 'app.js')} and reload.

  No npm. No GitHub. No deploy. No PR. Instant feedback.
  Every save is auto-saved as an immutable version — you cannot lose work,
  and you can go back to any of them.

  Next, when you want it:
    deck vendor https://esm.sh/three@0.160.0 --name three --version 0.160.0 \\
      --store ${storeDir} --tag latest      # any ESM library, pulled in for good
    deck release --store ${storeDir} --name ${name} --version 1.0.0 \\
      --from dev --tag latest               # freeze this state as a real version
    deck pack ${appDir}                     # the whole app as one shareable file
`);
      });
      return;
    }
    case 'serve': {
      let { values } = parseArgs({
        args: rest,
        options: {
          store: { type: 'string' },
          port: { type: 'string', default: '8787' },
          watch: { type: 'string', multiple: true, default: [] },
          as: { type: 'string', multiple: true, default: [] },
        },
      });
      if (!values.store) {
        fail(
          'usage: deck serve --store <dir> [--port <p>] [--watch <dir> --as <name>]...',
        );
      }
      if (values.watch!.length !== values.as!.length) {
        fail('each --watch <dir> needs a matching --as <name>');
      }
      let live: Record<string, string> = {};
      for (let [i, dir] of values.watch!.entries()) {
        let name = values.as![i];
        live[name] = resolve(dir);
        watchAndPublish({
          dir: resolve(dir),
          name,
          storeDir: resolve(values.store),
          onPublish: ({ version, treeHash }) =>
            console.log(
              `auto-published ${name}@${version} (${treeHash.slice(0, 12)})`,
            ),
          onError: (error) => console.error(`watch ${name}: ${error}`),
        });
      }
      let server = createDeckServer({ storeDir: resolve(values.store), live });
      let port = Number(values.port);
      server.listen(port, () => {
        console.log(
          `deck server on http://localhost:${port} (read-only, store: ${values.store})`,
        );
        for (let name of Object.keys(live)) {
          console.log(
            `  live: http://localhost:${port}/live/${name} — auto-publishes ${name}@<base>-dev.N (tag: dev)`,
          );
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
