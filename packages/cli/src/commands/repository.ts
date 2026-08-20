import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import {
  createPullRequest,
  mergePullRequest,
} from '@cardstack/deck/pull-request-store';
import {
  captureRepositoryRevision,
  createRepositoryBranch,
  ensureRepositoryMain,
  readRepositoryConfig,
  resolveRepositoryConfig,
  repositoryConfig,
  REPOSITORY_CONFIG_FILE,
  REPOSITORY_CONFIG_SPEC,
} from '@cardstack/deck/repository-workflow';
import { defineCommand, type Command } from '../command.ts';
import { depotAt, fail } from '../support.ts';

function actor() {
  let name = process.env.DECK_ACTOR ?? process.env.USER ?? 'Deck agent';
  return {
    id: `@${name.toLowerCase().replace(/[^a-z0-9._-]+/g, '-')}:local`,
    name,
  };
}

async function configured(depotDir: string, identity?: string) {
  try {
    return await resolveRepositoryConfig(depotDir, identity);
  } catch (error) {
    fail((error as Error).message);
  }
}

const repoInit = defineCommand({
  name: 'repo-init',
  group: 'repository',
  summary: 'name a set of packages as one Repository and create main',
  usage: [
    'repo-init --depot <dir> --owner <owner> --name <name> --root <pkg> --member <pkg>...',
  ],
  detail: `Writes repository.json beside the depot import map, captures every
member package into CAS, and creates the main branch. The file names the
composition; immutable Repository and Revision objects carry its history.`,
  async run(argv) {
    let { values } = parseArgs({
      args: argv,
      options: {
        depot: { type: 'string' },
        owner: { type: 'string' },
        name: { type: 'string' },
        root: { type: 'string', multiple: true },
        member: { type: 'string', multiple: true },
        message: { type: 'string', default: 'Initialize Repository' },
      },
    });
    if (
      !values.depot ||
      !values.owner ||
      !values.name ||
      !values.root?.length ||
      !values.member?.length
    ) {
      fail(
        'usage: deck repo-init --depot <dir> --owner <owner> --name <name> --root <pkg> --member <pkg>...',
      );
    }
    let depot = depotAt(values.depot);
    if (await readRepositoryConfig(depot.dir))
      fail(`${REPOSITORY_CONFIG_FILE} already exists`);
    let config = repositoryConfig({
      schema: REPOSITORY_CONFIG_SPEC,
      owner: values.owner,
      name: values.name,
      roots: values.root,
      members: values.member,
    });
    await writeFile(
      join(depot.dir, REPOSITORY_CONFIG_FILE),
      `${JSON.stringify(config, null, 2)}\n`,
      { flag: 'wx' },
    );
    let captured = await captureRepositoryRevision({
      depotDir: depot.dir,
      storeDir: depot.storeDir,
      config,
      branch: 'main',
      message: values.message,
      author: actor(),
    });
    console.log(
      `initialized ${config.owner}/${config.name}:main ${captured.revisionHash.slice(0, 12)} (${config.members.length} packages)`,
    );
  },
});

const branch = defineCommand({
  name: 'branch',
  group: 'repository',
  summary: 'create a familiar branch ref over Repository Revisions',
  usage: [
    'branch --depot <dir> --repo <publisher/package> --name <branch> [--from main]',
  ],
  async run(argv) {
    let { values } = parseArgs({
      args: argv,
      options: {
        depot: { type: 'string' },
        repo: { type: 'string' },
        name: { type: 'string' },
        from: { type: 'string', default: 'main' },
      },
    });
    if (!values.depot || !values.name)
      fail(
        'usage: deck branch --depot <dir> --repo <publisher/package> --name <branch> [--from main]',
      );
    let depot = depotAt(values.depot);
    let config = await configured(depot.dir, values.repo);
    await ensureRepositoryMain({
      depotDir: depot.dir,
      storeDir: depot.storeDir,
      config,
      author: actor(),
    });
    let hash = await createRepositoryBranch({
      storeDir: depot.storeDir,
      config,
      branch: values.name,
      from: values.from,
    });
    console.log(
      `branched ${config.owner}/${config.name}:${values.name} from ${values.from} at ${hash.slice(0, 12)}`,
    );
  },
});

const commit = defineCommand({
  name: 'commit',
  group: 'repository',
  summary: 'capture every member package as one atomic Revision',
  usage: [
    'commit --depot <dir> --repo <publisher/package> --branch <branch> --message <message>',
  ],
  async run(argv) {
    let { values } = parseArgs({
      args: argv,
      options: {
        depot: { type: 'string' },
        repo: { type: 'string' },
        branch: { type: 'string' },
        message: { type: 'string' },
      },
    });
    if (!values.depot || !values.branch || !values.message)
      fail(
        'usage: deck commit --depot <dir> --branch <branch> --message <message>',
      );
    let depot = depotAt(values.depot);
    let config = await configured(depot.dir, values.repo);
    let captured = await captureRepositoryRevision({
      depotDir: depot.dir,
      storeDir: depot.storeDir,
      config,
      branch: values.branch,
      message: values.message,
      author: actor(),
    });
    console.log(
      `committed ${config.owner}/${config.name}:${values.branch} ${captured.revisionHash.slice(0, 12)}`,
    );
  },
});

const review = defineCommand({
  name: 'review',
  group: 'repository',
  summary: 'open a durable review from one branch into another',
  usage: [
    'review --depot <dir> --repo <publisher/package> --source <branch> --title <title> [--target main] [--body <text>]',
  ],
  async run(argv) {
    let { values } = parseArgs({
      args: argv,
      options: {
        depot: { type: 'string' },
        repo: { type: 'string' },
        source: { type: 'string' },
        target: { type: 'string', default: 'main' },
        title: { type: 'string' },
        body: { type: 'string', default: '' },
      },
    });
    if (!values.depot || !values.source || !values.title)
      fail(
        'usage: deck review --depot <dir> --source <branch> --title <title> [--target main]',
      );
    let depot = depotAt(values.depot);
    let config = await configured(depot.dir, values.repo);
    let opened = await createPullRequest({
      storeDir: depot.storeDir,
      target: {
        owner: config.owner,
        repository: config.name,
        branch: values.target,
      },
      source: {
        owner: config.owner,
        repository: config.name,
        branch: values.source,
      },
      title: values.title,
      body: values.body,
      author: actor(),
      createdAt: new Date().toISOString(),
    });
    console.log(
      `opened review ${config.owner}/${config.name}#${opened.ref.number}: ${values.source} → ${values.target}`,
    );
  },
});

const merge = defineCommand({
  name: 'merge',
  group: 'repository',
  summary: 'merge a review with compare-and-swap branch safety',
  usage: ['merge --depot <dir> --repo <publisher/package> --number <n>'],
  async run(argv) {
    let { values } = parseArgs({
      args: argv,
      options: {
        depot: { type: 'string' },
        repo: { type: 'string' },
        number: { type: 'string' },
      },
    });
    let number = Number(values.number);
    if (!values.depot || !Number.isSafeInteger(number) || number < 1)
      fail('usage: deck merge --depot <dir> --number <n>');
    let depot = depotAt(values.depot);
    let config = await configured(depot.dir, values.repo);
    let result = await mergePullRequest({
      storeDir: depot.storeDir,
      owner: config.owner,
      repository: config.name,
      number,
      actor: actor(),
      createdAt: new Date().toISOString(),
    });
    if (result.state === 'conflicted') {
      console.log(
        `conflicted ${config.owner}/${config.name}#${number}: ${result.conflicts.join(', ')}`,
      );
      process.exitCode = 1;
      return;
    }
    console.log(
      `merged ${config.owner}/${config.name}#${number} ${result.mergeRevisionHash.slice(0, 12)}`,
    );
  },
});

export const REPOSITORY_COMMANDS: Command[] = [
  repoInit,
  branch,
  commit,
  review,
  merge,
];
