import { parseArgs } from 'node:util';
import { createBranchReview, mergeReview } from '@cardstack/deck/review-store';
import {
  captureRepositoryCheckpoint,
  createRepositoryBranch,
  readRepositoryConfig,
  repositoryConfig,
  repositoryIdentity,
  resolveRepositoryContext,
  writeRepositoryConfig,
  REPOSITORY_CONFIG_FILE,
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

async function configured(realmDir: string, identity?: string) {
  try {
    return await resolveRepositoryContext(realmDir, identity);
  } catch (error) {
    fail((error as Error).message);
  }
}

function packageRRI(value: string): string {
  if (!/^[a-z0-9][a-z0-9._-]{0,63}\/[a-z0-9][a-z0-9._-]{0,63}$/.test(value)) {
    fail(`package must be <owner>/<name>: ${value}`);
  }
  return `@${value}/`;
}

function requireSettlement(values: { history?: string; index?: string }) {
  if (!values.history || !values.index) {
    fail('a Checkpoint requires --history <deckd-head> and --index <generation-hash>');
  }
  if (!/^[0-9a-f]{64}$/.test(values.index)) fail('--index must be a SHA-256 hash');
  return { historyHead: values.history, indexGenerationHash: values.index };
}

const repoInit = defineCommand({
  name: 'repo-init',
  group: 'repository',
  summary: 'name packages that advance as one Repository and create main',
  usage: [
    'repo-init --depot <dir> --owner <owner> --name <name> --root <pkg> --member <pkg>... --history <head> --index <hash>',
  ],
  detail: `Writes .deck/repository.json, captures each member package and the
RRI lock, creates an initial Checkpoint, and points main at its exact
Repository, History head, and completed index generation.`,
  async run(argv) {
    let { values } = parseArgs({
      args: argv,
      options: {
        depot: { type: 'string' },
        owner: { type: 'string' },
        name: { type: 'string' },
        root: { type: 'string', multiple: true },
        member: { type: 'string', multiple: true },
        history: { type: 'string' },
        index: { type: 'string' },
        message: { type: 'string', default: 'Initialize Repository' },
      },
    });
    if (!values.depot || !values.owner || !values.name || !values.root?.length || !values.member?.length) {
      fail('usage: deck repo-init --depot <dir> --owner <owner> --name <name> --root <pkg> --member <pkg>... --history <head> --index <hash>');
    }
    let depot = depotAt(values.depot);
    if (await readRepositoryConfig(depot.dir)) fail(`${REPOSITORY_CONFIG_FILE} already exists`);
    let repositoryRoot = `@${values.owner}/${values.name}/`;
    let memberRRI = (path: string) =>
      path === values.root![0] ? repositoryRoot : packageRRI(path);
    let members = Object.fromEntries(values.member.map((path) => [memberRRI(path), path]));
    let config = repositoryConfig({
      schema: 'deck-repository-manifest-v2',
      roots: values.root.map(memberRRI),
      members,
    });
    await writeRepositoryConfig(depot.dir, config);
    let captured = await captureRepositoryCheckpoint({
      realmDir: depot.dir,
      config,
      branch: 'main',
      message: values.message,
      author: actor(),
      ...requireSettlement(values),
    });
    console.log(
      `initialized ${values.owner}/${values.name}:main ${captured.checkpointHash.slice(0, 12)} (${Object.keys(config.members).length} packages)`,
    );
  },
});

const branch = defineCommand({
  name: 'branch',
  group: 'repository',
  summary: 'clone a Repository branch head',
  usage: ['branch --depot <dir> --repo <owner/package> --name <branch> [--from main]'],
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
    if (!values.depot || !values.repo || !values.name) fail('usage: deck branch --depot <dir> --repo <owner/package> --name <branch> [--from main]');
    let depot = depotAt(values.depot);
    let context = await configured(depot.dir, values.repo);
    let head = await createRepositoryBranch({ realmDir: context.realmDir, branch: values.name, from: values.from });
    console.log(`branched ${values.name} from ${values.from} at ${head.latestCheckpointHash?.slice(0, 12) ?? 'uncheckpointed'}`);
  },
});

const checkpointCommand = defineCommand({
  name: 'checkpoint',
  group: 'repository',
  summary: 'name the current Repository, History, and index as one Checkpoint',
  usage: [
    'checkpoint --depot <dir> --repo <owner/package> --branch <branch> --message <message> --history <head> --index <hash>',
  ],
  async run(argv) {
    let { values } = parseArgs({
      args: argv,
      options: {
        depot: { type: 'string' },
        repo: { type: 'string' },
        branch: { type: 'string' },
        message: { type: 'string' },
        history: { type: 'string' },
        index: { type: 'string' },
      },
    });
    if (!values.depot || !values.branch || !values.message) {
      fail('usage: deck checkpoint --depot <dir> --repo <owner/package> --branch <branch> --message <message> --history <head> --index <hash>');
    }
    let depot = depotAt(values.depot);
    let context = await configured(depot.dir, values.repo);
    let captured = await captureRepositoryCheckpoint({
      realmDir: context.realmDir,
      config: context.config,
      branch: values.branch,
      message: values.message,
      author: actor(),
      ...requireSettlement(values),
    });
    console.log(`checkpointed ${repositoryIdentity(context.config)}:${values.branch} ${captured.checkpointHash.slice(0, 12)}`);
  },
});

const reviewCommand = defineCommand({
  name: 'review',
  group: 'repository',
  summary: 'open a durable Review from one branch into another',
  usage: [
    'review --depot <dir> --repo <owner/package> --source <branch> --title <title> [--target main] [--body <text>]',
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
    if (!values.depot || !values.repo || !values.source || !values.title) {
      fail('usage: deck review --depot <dir> --repo <owner/package> --source <branch> --title <title> [--target main]');
    }
    let depot = depotAt(values.depot);
    let context = await configured(depot.dir, values.repo);
    let opened = await createBranchReview({
      realmDir: context.realmDir,
      repository: packageRRI(values.repo),
      sourceBranch: values.source,
      targetBranch: values.target,
      title: values.title,
      body: values.body,
      author: actor(),
      createdAt: new Date().toISOString(),
    });
    console.log(`opened Review #${opened.ref.number}: ${values.source} → ${values.target}`);
  },
});

const merge = defineCommand({
  name: 'merge',
  group: 'repository',
  summary: 'merge a Review with compare-and-swap branch safety',
  usage: ['merge --depot <dir> --repo <owner/package> --number <n> --history <head> --index <hash>'],
  async run(argv) {
    let { values } = parseArgs({
      args: argv,
      options: {
        depot: { type: 'string' },
        repo: { type: 'string' },
        number: { type: 'string' },
        history: { type: 'string' },
        index: { type: 'string' },
      },
    });
    let number = Number(values.number);
    if (!values.depot || !values.repo || !Number.isSafeInteger(number) || number < 1) {
      fail('usage: deck merge --depot <dir> --repo <owner/package> --number <n> --history <head> --index <hash>');
    }
    let depot = depotAt(values.depot);
    let context = await configured(depot.dir, values.repo);
    let result = await mergeReview({
      realmDir: context.realmDir,
      number,
      actor: actor(),
      createdAt: new Date().toISOString(),
      ...requireSettlement(values),
    });
    if (result.state === 'conflicted') {
      console.log(`conflicted Review #${number}: ${result.conflicts.join(', ')}`);
      process.exitCode = 1;
      return;
    }
    console.log(`merged Review #${number} ${result.mergeCheckpointHash.slice(0, 12)}`);
  },
});

export const REPOSITORY_COMMANDS: Command[] = [
  repoInit,
  branch,
  checkpointCommand,
  reviewCommand,
  merge,
];
