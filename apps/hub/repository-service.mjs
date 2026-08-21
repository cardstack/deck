// Realm-local Repository/Checkpoint/Review adapter for Deck Hub.
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { forkDeck } from '@cardstack/deck/fork';
import { readForkedFrom } from '@cardstack/deck/offer';
import { readObject, readTree, rebuildPack } from '@cardstack/deck/object-store';
import {
  canonicalJson,
  changedMembers,
  checkpoint,
  hashProtocolObject,
  repository,
} from '@cardstack/deck/repository';
import {
  readBranchHead,
  readCheckpoint,
  readRepository,
  readRepositoryLock,
  realmDeckPath,
  realmDeckStoreDir,
  storeCheckpoint,
  storeRepository,
} from '@cardstack/deck/repository-store';
import {
  createRepositoryBranch,
  ensureRepositoryMain,
  readRepositoryConfig,
  repositoryIdentity,
} from '@cardstack/deck/repository-workflow';
import {
  createBranchReview,
  createReview,
  mergeReview,
  previewReview,
  readReview,
} from '@cardstack/deck/review-store';
import { reviewEventHash, reviewHash } from '@cardstack/deck/review';
import { parseRRI } from '@cardstack/deck/rri';
import { publishToStore, readStoreMeta } from '@cardstack/deck/store';
import { writeTreeToDir } from '@cardstack/deck/tree';

const json = (res, status, value) => {
  let bytes = Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': bytes.length,
  });
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
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch {
    return [];
  }
  let names = [];
  for (let entry of entries) {
    let name = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      names.push(...(await namesBelow(join(directory, entry.name), suffix, name)));
    } else if (entry.name.endsWith(suffix)) {
      names.push(name.slice(0, -suffix.length));
    }
  }
  return names.sort();
}

async function valuesBelow(directory) {
  let names = await namesBelow(directory);
  return Promise.all(
    names.map(async (name) => [name, await readFile(join(directory, `${name}.json`), 'utf8')]),
  );
}

function identity(config) {
  return repositoryIdentity(config);
}

function identityParts(config) {
  let { scope: owner, name } = parseRRI(config.roots[0]);
  return { owner, name };
}

function implicitConfig(owner, name) {
  let root = `@${owner}/${name}/`;
  return {
    schema: 'deck-repository-manifest-v2',
    roots: [root],
    members: { [root]: '.' },
  };
}

function storageName(entry, memberRRI) {
  let path = entry.config.members[memberRRI];
  return path === '.' ? entry.repository : path;
}

export async function createRepositoryService({ depots, log = console.log, onChange = () => {} }) {
  let repositories = [];
  let queues = new Map();

  function addEntry(depot, realmDir, config, kind, forkedFrom) {
    let repository = identity(config);
    let existing = repositories.find(
      (entry) => entry.depot.name === depot.name && entry.repository === repository,
    );
    if (existing) {
      if (forkedFrom) existing.forkedFrom = forkedFrom;
      return existing;
    }
    let { owner, name } = identityParts(config);
    let entry = { depot, realmDir, config, kind, forkedFrom, repository, owner, name };
    repositories.push(entry);
    return entry;
  }

  for (let depot of depots) {
    let grouped = await readRepositoryConfig(depot.dir);
    let groupedPaths = new Set(grouped ? Object.values(grouped.members) : []);
    if (grouped) addEntry(depot, depot.dir, grouped, 'group');
    let publishers = await readdir(depot.dir, { withFileTypes: true }).catch(() => []);
    for (let publisher of publishers) {
      if (!publisher.isDirectory() || publisher.name.startsWith('.') || publisher.name.startsWith('_')) continue;
      let packages = await readdir(join(depot.dir, publisher.name), { withFileTypes: true }).catch(() => []);
      for (let pkg of packages) {
        if (!pkg.isDirectory()) continue;
        let localName = `${publisher.name}/${pkg.name}`;
        if (groupedPaths.has(localName)) continue;
        let realmDir = join(depot.dir, publisher.name, pkg.name);
        try {
          JSON.parse(await readFile(join(realmDir, 'package.json'), 'utf8'));
        } catch {
          continue;
        }
        let forkedFrom;
        try {
          forkedFrom = readForkedFrom(await readFile(join(realmDir, 'importmap.json'), 'utf8'), pkg.name);
        } catch {}
        addEntry(depot, realmDir, implicitConfig(publisher.name, pkg.name), 'package', forkedFrom);
      }
    }
  }

  function serial(entry, action) {
    let prior = queues.get(entry.realmDir) ?? Promise.resolve();
    let next = prior.then(action, action);
    queues.set(entry.realmDir, next.catch(() => undefined));
    return next;
  }

  async function project(entry, repositoryHash, value) {
    let version = versionFor(repositoryHash);
    let members = {};
    let rriMembers = {};
    for (let [memberRRI, treeHash] of Object.entries(value.members)) {
      let name = storageName(entry, memberRRI);
      if (!(await readStoreMeta(entry.depot.storeDir, name))?.versions?.[version]) {
        let bytes = await rebuildPack(realmDeckStoreDir(entry.realmDir), treeHash);
        if (!bytes) throw new Error(`missing package tree ${treeHash}`);
        await publishToStore(entry.depot.storeDir, name, version, bytes);
      }
      members[name] = `/${entry.depot.name}/${name}@${version}`;
      rriMembers[memberRRI] = members[name];
    }
    let rootName = storageName(entry, value.roots[0]);
    let query = new URLSearchParams({ at: `${members[rootName]}/index.html` });
    for (let name of Object.keys(members).filter((name) => name !== rootName)) {
      query.append('with', `${name}=${name}@${version}`);
    }
    return { version, runUrl: `/run?${query.toString()}`, members, rriMembers };
  }

  async function branchState(entry, name) {
    let head = await readBranchHead(entry.realmDir, name);
    if (!head) return undefined;
    let value = await readRepository(entry.realmDir, head.repositoryHash);
    if (!value) throw new Error(`branch ${name} points at a missing Repository`);
    let point = head.latestCheckpointHash
      ? await readCheckpoint(entry.realmDir, head.latestCheckpointHash)
      : undefined;
    return {
      name,
      checkpointHash: head.latestCheckpointHash,
      repositoryHash: head.repositoryHash,
      historyHead: head.historyHead,
      indexGenerationHash: head.indexGenerationHash,
      generation: head.generation,
      parents: point?.parents ?? [],
      author: point?.author ?? { id: '@deck:save', name: 'Every-save History' },
      message: point?.message ?? 'Uncheckpointed saves',
      createdAt: point?.createdAt ?? '',
      projection: await project(entry, head.repositoryHash, value),
    };
  }

  async function reviewNumbers(entry) {
    return (await namesBelow(realmDeckPath(entry.realmDir, 'reviews', 'numbers')))
      .map(Number)
      .filter((number) => Number.isSafeInteger(number) && number > 0)
      .sort((a, b) => b - a);
  }

  async function reviewState(entry, number) {
    let stored = await readReview(entry.realmDir, number);
    if (!stored) return undefined;
    return {
      number,
      state: stored.ref.state,
      title: stored.review.title,
      body: stored.review.body,
      source: stored.review.source,
      target: stored.review.target,
      base: stored.review.base,
      author: stored.review.author,
      createdAt: stored.review.createdAt,
      events: stored.events.map((event) => ({ ...event, hash: reviewEventHash(event) })),
    };
  }

  async function history(entry, branches) {
    let queue = branches.map((branch) => branch.checkpointHash).filter(Boolean);
    let names = new Map(
      branches.filter((branch) => branch.checkpointHash).map((branch) => [branch.checkpointHash, [branch.name]]),
    );
    let seen = new Set();
    let rows = [];
    while (queue.length && rows.length < 50) {
      let hash = queue.shift();
      if (seen.has(hash)) continue;
      seen.add(hash);
      let point = await readCheckpoint(entry.realmDir, hash);
      if (!point) continue;
      rows.push({ checkpointHash: hash, ...point, branches: names.get(hash) ?? [] });
      queue.push(...point.parents);
    }
    return rows.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  }

  async function state(entry) {
    let branchNames = await namesBelow(realmDeckPath(entry.realmDir, 'refs', 'heads'));
    let branches = (await Promise.all(branchNames.map((name) => branchState(entry, name)))).filter(Boolean);
    let main = branches.find((branch) => branch.name === 'main');
    let reviews = (
      await Promise.all((await reviewNumbers(entry)).map((number) => reviewState(entry, number)))
    ).filter(Boolean);
    let roots = entry.config.roots.map((root) => storageName(entry, root));
    let members = Object.keys(entry.config.members).map((member) => storageName(entry, member));
    let common = {
      repository: entry.repository,
      repositoryRRI: entry.config.roots[0],
      kind: entry.kind,
      forkedFrom: entry.forkedFrom,
      owner: entry.owner,
      name: entry.name,
      depot: entry.depot.name,
      roots,
      memberRRIs: Object.keys(entry.config.members),
      members,
    };
    if (!main) return { ...common, initialized: false, branches: [], reviews: [], history: [], protocol: [] };
    let selectedReview = reviews.find((item) => item.state === 'open') ?? reviews[0];
    let preview = selectedReview?.state === 'open'
      ? await previewReview(entry.realmDir, selectedReview.number)
      : undefined;
    let previewProjection = preview?.state === 'ready'
      ? await project(entry, preview.repositoryHash, preview.repository)
      : undefined;
    let comparison;
    if (selectedReview) {
      let [basePoint, sourcePoint] = await Promise.all([
        readCheckpoint(entry.realmDir, selectedReview.base.checkpointHash),
        readCheckpoint(entry.realmDir, selectedReview.source.checkpointHash),
      ]);
      let [baseRepository, sourceRepository] = await Promise.all([
        basePoint && readRepository(entry.realmDir, basePoint.repositoryHash),
        sourcePoint && readRepository(entry.realmDir, sourcePoint.repositoryHash),
      ]);
      if (basePoint && sourcePoint && baseRepository && sourceRepository) {
        comparison = {
          names: preview?.state === 'ready'
            ? preview.changedMembers
            : changedMembers(baseRepository, sourceRepository),
          before: await project(entry, basePoint.repositoryHash, baseRepository),
          after: previewProjection ?? (await project(entry, sourcePoint.repositoryHash, sourceRepository)),
        };
      }
    }
    let changes = comparison
      ? comparison.names.map((memberRRI) => {
          let name = storageName(entry, memberRRI);
          return {
            name: memberRRI,
            browseUrl: `/browse?${new URLSearchParams({
              at: `${comparison.after.members[name]}/index.js`,
              vs: `${comparison.before.members[name]}/index.js`,
            })}`,
          };
        })
      : [];
    let protocol = [];
    let seenCheckpoints = new Set();
    let seenRepositories = new Set();
    let seenLocks = new Set();
    let seenIndexes = new Set();
    for (let branch of branches) {
      protocol.push({
        label: `${branch.name} branch head`,
        path: `.deck/refs/heads/${branch.name}.json`,
        value: await readBranchHead(entry.realmDir, branch.name),
      });
      if (branch.checkpointHash && !seenCheckpoints.has(branch.checkpointHash)) {
        seenCheckpoints.add(branch.checkpointHash);
        protocol.push({
          label: `${branch.name} Checkpoint`,
          path: `.deck/store/_checkpoints/${branch.checkpointHash.slice(0, 2)}/${branch.checkpointHash}.json`,
          value: await readCheckpoint(entry.realmDir, branch.checkpointHash),
        });
      }
      if (!seenRepositories.has(branch.repositoryHash)) {
        seenRepositories.add(branch.repositoryHash);
        let repositoryValue = await readRepository(entry.realmDir, branch.repositoryHash);
        protocol.push({
          label: `${branch.name} Repository`,
          path: `.deck/store/_repositories/${branch.repositoryHash.slice(0, 2)}/${branch.repositoryHash}.json`,
          value: repositoryValue,
        });
        if (repositoryValue && !seenLocks.has(repositoryValue.lockHash)) {
          seenLocks.add(repositoryValue.lockHash);
          protocol.push({
            label: `${branch.name} RRI lock`,
            path: `.deck/store/_locks/${repositoryValue.lockHash.slice(0, 2)}/${repositoryValue.lockHash}.json`,
            value: await readRepositoryLock(entry.realmDir, repositoryValue.lockHash),
          });
        }
      }
      if (!seenIndexes.has(branch.indexGenerationHash)) {
        seenIndexes.add(branch.indexGenerationHash);
        let indexPath = realmDeckPath(
          entry.realmDir,
          'indexes',
          branch.indexGenerationHash.slice(0, 2),
          branch.indexGenerationHash,
          'manifest.json',
        );
        let indexValue;
        try {
          indexValue = JSON.parse(await readFile(indexPath, 'utf8'));
        } catch {}
        protocol.push({
          label: `${branch.name} index generation`,
          path: `.deck/indexes/${branch.indexGenerationHash.slice(0, 2)}/${branch.indexGenerationHash}/manifest.json`,
          value: indexValue ?? { unavailable: true },
        });
      }
    }
    for (let item of reviews) {
      let stored = await readReview(entry.realmDir, item.number);
      if (!stored) continue;
      let openingHash = reviewHash(stored.review);
      protocol.push({
        label: `Review #${item.number} head`,
        path: `.deck/reviews/numbers/${item.number}.json`,
        value: stored.ref,
      });
      protocol.push({
        label: `Review #${item.number} opening`,
        path: `.deck/reviews/objects/${openingHash.slice(0, 2)}/${openingHash}.json`,
        value: stored.review,
      });
      for (let event of stored.events) {
        let hash = reviewEventHash(event);
        protocol.push({
          label: `Review #${item.number} ${event.type}`,
          path: `.deck/reviews/events/${hash.slice(0, 2)}/${hash}.json`,
          value: event,
        });
      }
    }
    return {
      ...common,
      initialized: true,
      main,
      branches,
      reviews,
      review: selectedReview ?? null,
      preview: preview ? { ...preview, projection: previewProjection } : undefined,
      changes,
      history: await history(entry, branches),
      protocol,
    };
  }

  async function settlement(entry, message, actor, repositoryHash = undefined) {
    let backend = entry.depot.history;
    if (!backend) throw new Error('deckd History is required to move a Repository branch');
    let historyHead =
      (await backend.seal(entry.realmDir, message, {
        name: actor?.name ?? actor?.id ?? 'Deck Hub',
      })) ?? (await backend.head(entry.realmDir));
    if (!historyHead) throw new Error('deckd did not produce a History head');
    let manifest = {
      schema: 'deck-file-index-generation-v1',
      repository: entry.config.roots[0],
      historyHead,
      ...(repositoryHash ? { repositoryHash } : {}),
    };
    let indexGenerationHash = hashProtocolObject(manifest);
    let path = realmDeckPath(entry.realmDir, 'indexes', indexGenerationHash.slice(0, 2), indexGenerationHash, 'manifest.json');
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, canonicalJson(manifest));
    return { historyHead, indexGenerationHash };
  }

  async function ensureMain(entry, actor) {
    let current = await readBranchHead(entry.realmDir, 'main');
    if (current?.latestCheckpointHash) return current.latestCheckpointHash;
    let settled = await settlement(entry, `Initialize ${entry.repository}`, actor);
    return ensureRepositoryMain({
      realmDir: entry.realmDir,
      config: entry.config,
      author: actor,
      ...settled,
    });
  }

  async function filesForTree(entry, treeHash) {
    let storeDir = realmDeckStoreDir(entry.realmDir);
    let tree = await readTree(storeDir, treeHash);
    if (!tree) throw new Error(`missing tree ${treeHash}`);
    let files = new Map();
    for (let item of tree.entries) {
      let bytes = await readObject(storeDir, item.sha256);
      if (!bytes) throw new Error(`missing object ${item.sha256}`);
      files.set(item.path, bytes);
    }
    return files;
  }

  async function applyRepository(entry, value) {
    for (let [memberRRI, treeHash] of Object.entries(value.members)) {
      let path = entry.config.members[memberRRI];
      if (!path) throw new Error(`Repository contains non-member ${memberRRI}`);
      await writeTreeToDir(path === '.' ? entry.realmDir : join(entry.realmDir, path), await filesForTree(entry, treeHash));
    }
  }

  async function changed(entry, action) {
    let result = await serial(entry, action);
    onChange({ name: `repository:${entry.repository}`, treeHash: String(Date.now()) });
    return result;
  }

  return {
    async list() {
      return {
        repositories: await Promise.all(
          repositories.map(async (entry) => ({
            repository: entry.repository,
            repositoryRRI: entry.config.roots[0],
            kind: entry.kind,
            forkedFrom: entry.forkedFrom,
            owner: entry.owner,
            name: entry.name,
            depot: entry.depot.name,
            roots: entry.config.roots.map((root) => storageName(entry, root)),
            members: Object.keys(entry.config.members).map((member) => storageName(entry, member)),
            initialized: Boolean(await readBranchHead(entry.realmDir, 'main')),
            url: `/_hub/repositories/${entry.depot.name}/${entry.owner}/${entry.name}`,
          })),
        ),
      };
    },
    async fingerprint() {
      let parts = [];
      for (let entry of repositories) {
        parts.push([
          entry.depot.name,
          entry.repository,
          await valuesBelow(realmDeckPath(entry.realmDir, 'refs')),
          await valuesBelow(realmDeckPath(entry.realmDir, 'reviews', 'numbers')),
        ]);
      }
      return JSON.stringify(parts);
    },
    async handle(req, res, path) {
      if (path === '/_hub/repositories' && req.method === 'GET') {
        json(res, 200, await this.list());
        return true;
      }
      if (path === '/_hub/forks' && req.method === 'POST') {
        try {
          let body = await bodyOf(req);
          let depot = depots.find((candidate) => candidate.name === body.depot);
          if (!depot) throw new Error(`depot not found: ${body.depot}`);
          let [fromPublisher, fromPackage, ...fromRest] = String(body.from ?? '').split('/');
          let [toPublisher, toPackage, ...toRest] = String(body.to ?? '').split('/');
          if (!fromPublisher || !fromPackage || fromRest.length || !toPublisher || !toPackage || toRest.length) {
            throw new Error('from and to must be owner/package');
          }
          let sourceEntry = repositories.find(
            (entry) => entry.depot === depot && entry.repository === `${fromPublisher}/${fromPackage}`,
          );
          let baseCheckpointHash;
          if (sourceEntry && !body.spec) {
            baseCheckpointHash = await ensureMain(sourceEntry, {
              id: body.actor ?? '@hub:local',
              name: body.actorName ?? 'Deck Hub',
            });
          }
          let result = await forkDeck({
            depotDir: depot.dir,
            storeDir: depot.storeDir,
            from: { publisher: fromPublisher, package: fromPackage, ...(body.spec ? { spec: body.spec } : {}) },
            to: { publisher: toPublisher, package: toPackage },
            actor: body.actor ?? '@hub:local',
            baseCheckpointHash,
          });
          let realmDir = join(depot.dir, toPublisher, toPackage);
          let entry = addEntry(
            depot,
            realmDir,
            implicitConfig(toPublisher, toPackage),
            'package',
            {
              package: body.from,
              ...(result.version ? { version: result.version } : {}),
              treeHash: result.baseTreeHash,
              ...(baseCheckpointHash ? { checkpointHash: baseCheckpointHash } : {}),
            },
          );
          await ensureMain(entry, {
            id: body.actor ?? '@hub:local',
            name: body.actorName ?? 'Deck Hub',
          });
          onChange({ name: `fork:${result.to}`, treeHash: result.baseTreeHash });
          log(`forked ${result.from} → ${result.to}`);
          json(res, 201, {
            ...result,
            repository: `${toPublisher}/${toPackage}`,
            browseUrl: `/browse?at=/${depot.name}/${toPublisher}/${toPackage}`,
          });
        } catch (error) {
          json(res, 409, { error: error.message });
        }
        return true;
      }

      let match = path.match(/^\/_hub\/repositories\/([^/]+)\/([^/]+)\/([^/]+)(.*)$/);
      if (!match) return false;
      let [, depotName, owner, name, tail] = match;
      let entry = repositories.find(
        (candidate) => candidate.owner === owner && candidate.name === name && candidate.depot.name === depotName,
      );
      if (!entry) {
        json(res, 404, { error: 'Repository not found' });
        return true;
      }
      try {
        if (req.method === 'GET' && !tail) {
          json(res, 200, await state(entry));
          return true;
        }
        let body = await bodyOf(req);
        if (req.method === 'POST' && tail === '/branches') {
          await changed(entry, async () => {
            await ensureMain(entry, body.author ?? { id: '@hub:local', name: 'Deck Hub' });
            return createRepositoryBranch({
              realmDir: entry.realmDir,
              branch: body.name,
              from: body.from ?? 'main',
            });
          });
        } else if (req.method === 'POST' && tail === '/reviews') {
          let sourceIdentity = String(body.sourceRepository ?? entry.repository);
          let sourceEntry = repositories.find(
            (candidate) => candidate.depot === entry.depot && candidate.repository === sourceIdentity,
          );
          if (!sourceEntry) throw new Error(`source Repository not found: ${sourceIdentity}`);
          await changed(entry, async () => {
            await ensureMain(entry, body.author ?? { id: '@hub:local', name: 'Deck Hub' });
            await ensureMain(sourceEntry, body.author ?? { id: '@hub:local', name: 'Deck Hub' });
            if (sourceEntry === entry) {
              return createBranchReview({
                realmDir: entry.realmDir,
                repository: entry.config.roots[0],
                sourceBranch: body.source,
                targetBranch: body.target ?? 'main',
                title: body.title,
                body: body.body ?? '',
                author: body.author ?? { id: '@hub:local', name: 'Deck Hub' },
                createdAt: new Date().toISOString(),
              });
            }
            if (
              sourceEntry.forkedFrom?.package !== entry.repository ||
              !sourceEntry.forkedFrom.checkpointHash
            ) {
              throw new Error(`${sourceIdentity} has no mutable fork lineage from ${entry.repository}`);
            }
            let [targetHead, sourceHead] = await Promise.all([
              readBranchHead(entry.realmDir, body.target ?? 'main'),
              readBranchHead(sourceEntry.realmDir, body.source),
            ]);
            if (!targetHead?.latestCheckpointHash || !sourceHead?.latestCheckpointHash) {
              throw new Error('Review endpoints require Checkpoints');
            }
            let [targetRepository, sourceRepository] = await Promise.all([
              readRepository(entry.realmDir, targetHead.repositoryHash),
              readRepository(sourceEntry.realmDir, sourceHead.repositoryHash),
            ]);
            if (!targetRepository || !sourceRepository) throw new Error('Review Repository is missing');
            let targetMembers = Object.keys(targetRepository.members);
            let sourceMembers = Object.keys(sourceRepository.members);
            if (targetMembers.length !== 1 || sourceMembers.length !== 1) {
              throw new Error('cross-owner Review currently requires one package on each side');
            }
            let normalized = repository({
              roots: targetRepository.roots,
              members: { [targetMembers[0]]: sourceRepository.members[sourceMembers[0]] },
              lockHash: targetRepository.lockHash,
            });
            let repositoryHash = await storeRepository(entry.realmDir, normalized);
            let sourcePoint = await readCheckpoint(sourceEntry.realmDir, sourceHead.latestCheckpointHash);
            if (!sourcePoint) throw new Error('source Checkpoint is missing');
            let normalizedPoint = checkpoint({
              repositoryHash,
              parents: [sourceHead.latestCheckpointHash],
              historyHead: sourcePoint.historyHead,
              indexGenerationHash: sourcePoint.indexGenerationHash,
              author: body.author ?? { id: '@hub:local', name: 'Deck Hub' },
              message: `Map ${sourceIdentity} onto ${entry.repository}`,
              createdAt: new Date().toISOString(),
            });
            let normalizedCheckpointHash = await storeCheckpoint(entry.realmDir, normalizedPoint);
            return createReview({
              realmDir: entry.realmDir,
              base: {
                repository: entry.config.roots[0],
                branch: body.target ?? 'main',
                checkpointHash: sourceEntry.forkedFrom.checkpointHash,
              },
              target: {
                repository: entry.config.roots[0],
                branch: body.target ?? 'main',
                checkpointHash: targetHead.latestCheckpointHash,
              },
              source: {
                repository: sourceEntry.config.roots[0],
                branch: body.source,
                checkpointHash: normalizedCheckpointHash,
              },
              title: body.title,
              body: body.body ?? '',
              author: body.author ?? { id: '@hub:local', name: 'Deck Hub' },
              createdAt: new Date().toISOString(),
            });
          });
        } else {
          let merge = tail.match(/^\/reviews\/(\d+)\/merge$/);
          if (!merge || req.method !== 'POST') {
            json(res, 404, { error: 'Repository action not found' });
            return true;
          }
          let result = await changed(entry, async () => {
            let number = Number(merge[1]);
            let preview = await previewReview(entry.realmDir, number);
            if (preview.state === 'conflicted') return preview;
            await applyRepository(entry, preview.repository);
            let settled = await settlement(
              entry,
              `Merge Review #${number}`,
              body.actor ?? { id: '@hub:local', name: 'Deck Hub' },
              preview.repositoryHash,
            );
            return mergeReview({
              realmDir: entry.realmDir,
              number,
              actor: body.actor ?? { id: '@hub:local', name: 'Deck Hub' },
              createdAt: new Date().toISOString(),
              ...settled,
            });
          });
          if (result.state === 'conflicted') {
            json(res, 409, result);
            return true;
          }
          log(`merged ${entry.repository}#${merge[1]} ${short(result.mergeCheckpointHash)}`);
        }
        json(res, 200, await state(entry));
        return true;
      } catch (error) {
        json(res, 409, { error: error.message });
        return true;
      }
    },
  };
}
