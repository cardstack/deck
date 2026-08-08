import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { unpack } from './pack.ts';
import { IMPORT_MAP_PATH } from './import-map.ts';
import { readStoreMeta, readStoredPack, resolveVersionSpec } from './store.ts';
import { DEFAULT_IGNORE } from './tree-hash.ts';

// Fork: take somebody else's deck and start changing it at byte speed,
// without asking, without planning to publish, without touching what they
// publish.
//
// Nothing new is needed to make that safe — the PUBLISHER SEGMENT already is
// the boundary. `acme/palette` and `you/palette` are different names, with
// different version lines, different dist-tags, different store entries, in
// the same realm. So a fork is: copy the tree into your own scope, point
// your app at it, and edit. Your saves auto-publish under YOUR name; acme's
// versions never move.
//
// Two cheap properties fall out of the rest of the design:
//   - a fork that has not diverged has the SAME treeHash as its source, so
//     the content-addressed store holds one copy of the bytes, not two
//   - the copy is an ordinary edit of the realm, so it is sealed like any
//     other — an experiment you can walk back from
//
// The source can be the live tree (what `ls` shows: the latest bytes) or any
// sealed version. Forking a version is the reproducible one; forking live is
// the one you want at 2am.

export interface ForkSource {
  publisher: string;
  package: string;
  // A version, range, or dist-tag. Omitted means the live tree.
  spec?: string;
}

export interface ForkTarget {
  publisher: string;
  package: string;
}

export interface ForkResult {
  from: string;
  to: string;
  // The exact version forked, when forking a sealed one.
  version?: string;
  files: string[];
  dir: string;
}

export interface ForkOptions {
  realmDir: string;
  storeDir: string;
  from: ForkSource;
  to: ForkTarget;
  force?: boolean;
}

async function readLiveTree(dir: string): Promise<Map<string, Buffer>> {
  let files = new Map<string, Buffer>();
  async function walk(current: string, prefix: string): Promise<void> {
    for (let entry of await readdir(current, { withFileTypes: true })) {
      if (DEFAULT_IGNORE.has(entry.name)) {
        continue;
      }
      let path = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
      if (entry.isDirectory()) {
        await walk(join(current, entry.name), path);
      } else if (entry.isFile()) {
        files.set(path, await readFile(join(current, entry.name)));
      }
    }
  }
  await walk(dir, '');
  return files;
}

// The map travels with the copy, so it has to say what the copy IS: the
// package key follows the new name, and the lineage is recorded rather than
// lost. Everything else the author wrote is left untouched.
function rewriteMap(
  mapText: string,
  from: ForkSource,
  to: ForkTarget,
  version: string | undefined,
): string {
  let parsed = JSON.parse(mapText);
  let vendor = parsed.deck ?? parsed.boxel;
  if (vendor?.packages?.[from.package] && from.package !== to.package) {
    vendor.packages[to.package] = vendor.packages[from.package];
    delete vendor.packages[from.package];
  }
  let entry = vendor?.packages?.[to.package];
  if (entry) {
    entry.forkedFrom = `${from.publisher}/${from.package}${
      version ? `@${version}` : ' (live)'
    }`;
  }
  return JSON.stringify(parsed, null, 2) + '\n';
}

export async function forkDeck(options: ForkOptions): Promise<ForkResult> {
  let { realmDir, storeDir, from, to, force } = options;
  let targetDir = join(realmDir, to.publisher, to.package);
  let exists = await stat(targetDir).then(
    () => true,
    () => false,
  );
  if (exists && !force) {
    throw new Error(
      `${to.publisher}/${to.package} already exists — pick another name, or pass force to overwrite`,
    );
  }

  let files: Map<string, Buffer>;
  let version: string | undefined;
  if (from.spec === undefined) {
    files = await readLiveTree(join(realmDir, from.publisher, from.package));
  } else {
    let name = `${from.publisher}/${from.package}`;
    let meta = await readStoreMeta(storeDir, name);
    if (!meta) {
      throw new Error(`no published versions for ${name}`);
    }
    let resolution = resolveVersionSpec(from.spec, meta);
    if (resolution.kind === 'not-found' || resolution.kind === 'invalid') {
      throw new Error(`${name}@${from.spec}: ${resolution.detail}`);
    }
    version = resolution.version;
    let bytes = await readStoredPack(storeDir, name, version);
    if (!bytes) {
      throw new Error(`${name}@${version} has no stored pack`);
    }
    files = unpack(bytes).files;
  }
  if (files.size === 0) {
    throw new Error(`${from.publisher}/${from.package} has no files to fork`);
  }

  let mapText = files.get(IMPORT_MAP_PATH)?.toString('utf8');
  if (mapText) {
    files.set(
      IMPORT_MAP_PATH,
      Buffer.from(rewriteMap(mapText, from, to, version), 'utf8'),
    );
  }
  for (let [path, bytes] of files) {
    let destination = join(targetDir, ...path.split('/'));
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, bytes);
  }
  return {
    from: `${from.publisher}/${from.package}${version ? `@${version}` : ''}`,
    to: `${to.publisher}/${to.package}`,
    version,
    files: [...files.keys()].sort(),
    dir: targetDir,
  };
}
