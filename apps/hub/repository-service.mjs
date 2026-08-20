// Collaboration adapter for Deck Hub. It treats every mutable package as a
// repository and discovers optional multi-package groups from
// depot-owned repository.json files and projects immutable Repository states
// back into ordinary package Versions for Browse and Run.
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { rebuildPack } from '@cardstack/deck/object-store';
import { createPullRequest, mergePullRequest, previewPullRequest, readPullRequest } from '@cardstack/deck/pull-request-store';
import { pullRequestEventHash } from '@cardstack/deck/pull-request';
import { changedMembers } from '@cardstack/deck/repository';
import { readBranchRef, readRepository, readRevision } from '@cardstack/deck/repository-store';
import { createRepositoryBranch, ensureRepositoryMain, readRepositoryConfig, REPOSITORY_CONFIG_SPEC } from '@cardstack/deck/repository-workflow';
import { publishToStore, readStoreMeta } from '@cardstack/deck/store';

const json = (res, status, value) => {
  let bytes = Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'content-length': bytes.length });
  res.end(bytes);
};
const short = (hash) => hash?.slice(0, 12);
const versionFor = (hash) => `1.0.0-repository.${short(hash)}`;

async function bodyOf(req) {
  let chunks = [];
  for await (let chunk of req) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
}

async function namesBelow(directory, suffix = '.json', prefix = '') {
  let entries;
  try { entries = await readdir(directory, { withFileTypes: true }); } catch { return []; }
  let names = [];
  for (let entry of entries) {
    let name = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) names.push(...await namesBelow(join(directory, entry.name), suffix, name));
    else if (entry.name.endsWith(suffix)) names.push(name.slice(0, -suffix.length));
  }
  return names.sort();
}

async function valuesBelow(directory) {
  let names = await namesBelow(directory);
  return Promise.all(names.map(async (name) => [name, await readFile(join(directory, `${name}.json`), 'utf8')]));
}

export async function createRepositoryService({ depots, log = console.log, onChange = () => {} }) {
  let repositories = [];
  for (let depot of depots) {
    let grouped = await readRepositoryConfig(depot.dir);
    if (grouped) repositories.push({ depot, config: grouped, kind: 'group' });
    let publishers;
    try { publishers = await readdir(depot.dir, { withFileTypes: true }); } catch { continue; }
    for (let publisher of publishers) {
      if (!publisher.isDirectory() || publisher.name.startsWith('.') || publisher.name.startsWith('_')) continue;
      let packages = await readdir(join(depot.dir, publisher.name), { withFileTypes: true }).catch(() => []);
      for (let pkg of packages) {
        if (!pkg.isDirectory()) continue;
        try { await readdir(join(depot.dir, publisher.name, pkg.name)); } catch { continue; }
        try {
          let packageJson = await readFile(join(depot.dir, publisher.name, pkg.name, 'package.json'), 'utf8');
          JSON.parse(packageJson);
        } catch { continue; }
        let identity = `${publisher.name}/${pkg.name}`;
        if (grouped && `${grouped.owner}/${grouped.name}` === identity) continue;
        repositories.push({ depot, kind: 'package', config: { schema: REPOSITORY_CONFIG_SPEC, owner: publisher.name, name: pkg.name, roots: [identity], members: [identity] } });
      }
    }
  }
  async function project(entry, repositoryHash, repository) {
    let version = versionFor(repositoryHash);
    for (let [name, treeHash] of Object.entries(repository.members)) {
      if (!(await readStoreMeta(entry.depot.storeDir, name))?.versions?.[version]) {
        let bytes = await rebuildPack(entry.depot.storeDir, treeHash);
        if (!bytes) throw new Error(`missing package tree ${treeHash}`);
        await publishToStore(entry.depot.storeDir, name, version, bytes);
      }
    }
    let root = repository.roots[0];
    let query = new URLSearchParams({ at: `/${entry.depot.name}/${root}@${version}/index.html` });
    for (let name of Object.keys(repository.members).filter((name) => name !== root)) query.append('with', `${name}=${name}@${version}`);
    return { version, runUrl: `/run?${query.toString()}`, members: Object.fromEntries(Object.keys(repository.members).map((name) => [name, `/${entry.depot.name}/${name}@${version}`])) };
  }

  async function branchState(entry, name) {
    let ref = await readBranchRef(entry.depot.storeDir, entry.config.owner, entry.config.name, name);
    if (!ref) return undefined;
    let value = await readRevision(entry.depot.storeDir, ref.revisionHash);
    let repository = value && await readRepository(entry.depot.storeDir, value.repositoryHash);
    if (!value || !repository) throw new Error(`branch ${name} points at missing protocol objects`);
    return { name, revisionHash: ref.revisionHash, repositoryHash: value.repositoryHash, generation: ref.generation, parents: value.parents, author: value.author, message: value.message, createdAt: value.createdAt, projection: await project(entry, value.repositoryHash, repository) };
  }

  async function pullNumbers(entry) {
    return (await namesBelow(join(entry.depot.storeDir, '_pulls', entry.config.owner, entry.config.name))).map(Number).filter((number) => Number.isSafeInteger(number) && number > 0).sort((a, b) => b - a);
  }

  async function pullState(entry, number) {
    let stored = await readPullRequest(entry.depot.storeDir, entry.config.owner, entry.config.name, number);
    if (!stored) return undefined;
    return { number, state: stored.ref.state, title: stored.request.title, body: stored.request.body, source: stored.request.source, target: stored.request.target, author: stored.request.author, createdAt: stored.request.createdAt, events: stored.events.map((event) => ({ ...event, hash: pullRequestEventHash(event) })) };
  }

  async function history(entry, branches) {
    let queue = branches.map((branch) => branch.revisionHash);
    let names = new Map(branches.map((branch) => [branch.revisionHash, [branch.name]]));
    let seen = new Set(); let rows = [];
    while (queue.length && rows.length < 50) {
      let hash = queue.shift();
      if (seen.has(hash)) continue;
      seen.add(hash);
      let revision = await readRevision(entry.depot.storeDir, hash);
      if (!revision) continue;
      rows.push({ revisionHash: hash, repositoryHash: revision.repositoryHash, parents: revision.parents, author: revision.author, message: revision.message, createdAt: revision.createdAt, branches: names.get(hash) ?? [] });
      queue.push(...revision.parents);
    }
    return rows.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  }

  async function state(entry) {
    let branchNames = await namesBelow(join(entry.depot.storeDir, '_refs', entry.config.owner, entry.config.name, 'heads'));
    let branches = (await Promise.all(branchNames.map((name) => branchState(entry, name)))).filter(Boolean);
    let main = branches.find((branch) => branch.name === 'main');
    let pulls = (await Promise.all((await pullNumbers(entry)).map((number) => pullState(entry, number)))).filter(Boolean);
    let common = { repository: `${entry.config.owner}/${entry.config.name}`, kind: entry.kind, owner: entry.config.owner, name: entry.config.name, depot: entry.depot.name, roots: entry.config.roots, members: entry.config.members };
    if (!main) return { ...common, initialized: false, branches: [], pulls: [], history: [], protocol: [] };
    let selectedPull = pulls.find((pull) => pull.state === 'open') ?? pulls[0];
    let preview = selectedPull?.state === 'open' ? await previewPullRequest(entry.depot.storeDir, entry.config.owner, entry.config.name, selectedPull.number) : undefined;
    let previewProjection = preview?.state === 'ready' ? await project(entry, preview.repositoryHash, preview.repository) : undefined;
    let comparison;
    if (selectedPull) {
      let [baseRevision, sourceRevision] = await Promise.all([
        readRevision(entry.depot.storeDir, selectedPull.target.revisionHash),
        readRevision(entry.depot.storeDir, selectedPull.source.revisionHash),
      ]);
      let [baseRepository, sourceRepository] = await Promise.all([
        baseRevision && readRepository(entry.depot.storeDir, baseRevision.repositoryHash),
        sourceRevision && readRepository(entry.depot.storeDir, sourceRevision.repositoryHash),
      ]);
      if (baseRepository && sourceRepository) {
        comparison = {
          names: preview?.state === 'ready' ? preview.changedMembers : changedMembers(baseRepository, sourceRepository),
          before: await project(entry, baseRevision.repositoryHash, baseRepository),
          after: previewProjection ?? await project(entry, sourceRevision.repositoryHash, sourceRepository),
        };
      }
    }
    let changes = comparison ? comparison.names.map((name) => ({ name, browseUrl: `/browse?${new URLSearchParams({ at: `${comparison.after.members[name]}/index.js`, vs: `${comparison.before.members[name]}/index.js` })}` })) : [];
    let protocol = [{ label: 'main branch ref', path: `_refs/${entry.config.owner}/${entry.config.name}/heads/main.json`, value: await readBranchRef(entry.depot.storeDir, entry.config.owner, entry.config.name, 'main') }];
    for (let branch of branches) protocol.push({ label: `${branch.name} Revision`, path: `_revisions/${branch.revisionHash.slice(0, 2)}/${branch.revisionHash}.json`, value: await readRevision(entry.depot.storeDir, branch.revisionHash) });
    for (let pull of pulls) protocol.push({ label: `review #${pull.number}`, path: `_pulls/${entry.config.owner}/${entry.config.name}/${pull.number}.json`, value: await readPullRequest(entry.depot.storeDir, entry.config.owner, entry.config.name, pull.number).then((value) => value.ref) });
    return { ...common, initialized: true, main, branches, pulls, pullRequest: selectedPull ?? null, preview: preview ? { ...preview, projection: previewProjection } : undefined, changes, history: await history(entry, branches), protocol };
  }

  async function changed(entry, action) {
    let result = await action();
    onChange({ name: `repository:${entry.config.owner}/${entry.config.name}`, treeHash: String(Date.now()) });
    return result;
  }

  return {
    async list() {
      return { repositories: await Promise.all(repositories.map(async ({ depot, config, kind }) => ({
        repository: `${config.owner}/${config.name}`, kind, owner: config.owner, name: config.name,
        depot: depot.name, roots: config.roots, members: config.members,
        initialized: Boolean(await readBranchRef(depot.storeDir, config.owner, config.name, 'main')),
        url: `/_hub/repositories/${depot.name}/${config.owner}/${config.name}`,
      }))) };
    },
    async fingerprint() {
      let parts = [];
      for (let depot of new Map(repositories.map((entry) => [entry.depot.name, entry.depot])).values()) {
        parts.push([
          depot.name,
          await valuesBelow(join(depot.storeDir, '_refs')),
          await valuesBelow(join(depot.storeDir, '_pulls')),
        ]);
      }
      return JSON.stringify(parts);
    },
    async handle(req, res, path) {
      if (path === '/_hub/repositories' && req.method === 'GET') { json(res, 200, await this.list()); return true; }
      let match = path.match(/^\/_hub\/repositories\/([^/]+)\/([^/]+)\/([^/]+)(.*)$/);
      if (!match) return false;
      let [, depotName, owner, name, tail] = match;
      let entry = repositories.find(({ depot, config }) => config.owner === owner && config.name === name && depot.name === depotName);
      if (!entry) { json(res, 404, { error: 'repository not found' }); return true; }
      try {
        if (req.method === 'GET' && !tail) { json(res, 200, await state(entry)); return true; }
        let body = await bodyOf(req);
        if (req.method === 'POST' && tail === '/branches') {
          await ensureRepositoryMain({ depotDir: entry.depot.dir, storeDir: entry.depot.storeDir, config: entry.config, author: body.author ?? { id: '@hub:local', name: 'Deck Hub' } });
          await changed(entry, () => createRepositoryBranch({ storeDir: entry.depot.storeDir, config: entry.config, branch: body.name, from: body.from ?? 'main' }));
        }
        else if (req.method === 'POST' && tail === '/pulls') await changed(entry, () => createPullRequest({ storeDir: entry.depot.storeDir, target: { owner, repository: name, branch: body.target ?? 'main' }, source: { owner, repository: name, branch: body.source }, title: body.title, body: body.body ?? '', author: body.author ?? { id: '@hub:local', name: 'Deck Hub' }, createdAt: new Date().toISOString() }));
        else {
          let merge = tail.match(/^\/pulls\/(\d+)\/merge$/);
          if (!merge || req.method !== 'POST') { json(res, 404, { error: 'repository action not found' }); return true; }
          let result = await changed(entry, () => mergePullRequest({ storeDir: entry.depot.storeDir, owner, repository: name, number: Number(merge[1]), actor: body.actor ?? { id: '@hub:local', name: 'Deck Hub' }, createdAt: new Date().toISOString() }));
          if (result.state === 'conflicted') { json(res, 409, result); return true; }
          log(`merged ${owner}/${name}#${merge[1]} ${short(result.mergeRevisionHash)}`);
        }
        json(res, 200, await state(entry)); return true;
      } catch (error) { json(res, 409, { error: error.message }); return true; }
    },
  };
}
