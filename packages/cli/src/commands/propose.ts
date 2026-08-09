// Contribution without branches.
//
// A fork records its base — package, version, and treeHash — in its own
// import map. That record is what makes a fork a PROPOSAL: nothing registers
// it, there is no branch and no side table, and because the proposal is a
// published version it already has a URL somebody can run. Reviewing means
// trying it (`?with=` at serve time), not reading a diff.

import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { forkDeck } from '@deck/core/fork';
import { lockDeck, parseDependencyValue } from '@deck/core/lock';
import { rebasePass } from '@deck/server/rebase-daemon';
import { defineCommand, type Command } from '../command.ts';
import { depotAt, fail } from '../support.ts';

const fork = defineCommand({
  name: 'fork',
  group: 'propose',
  summary: "copy someone's deck into YOUR publisher scope and change it",
  usage: [
    'fork --depot <dir> --from <pub>/<pkg>[@<version>] --as <pub>/<pkg>',
    '     [--use-in <pub>/<pkg>] [--force]',
  ],
  detail: `The publisher segment IS the fork boundary: acme/palette and
you/palette are different names with different version lines in the same
depot. Their versions never move, and an undiverged fork costs no bytes
because the store is content-addressed.

--use-in repoints a consumer's dependency at the fork, live — so the app you
are already running picks up every save you make to the fork with no
publish step in between. The repoint is an ALIAS, not a rename: the key
stays the specifier your source already imports.`,
  async run(argv) {
    let { values } = parseArgs({
      args: argv,
      options: {
        depot: { type: 'string' },
        from: { type: 'string' },
        as: { type: 'string' },
        'use-in': { type: 'string' },
        force: { type: 'boolean', default: false },
      },
    });
    if (!values.depot || !values.from || !values.as) {
      fail(
        'usage: deck fork --depot <dir> --from <pub>/<pkg>[@<version>] --as <pub>/<pkg> [--use-in <pub>/<pkg>]',
      );
    }
    let depot = depotAt(values.depot!);
    let [fromName, fromSpec] = values.from!.split('@');
    let [fromPublisher, fromPackage] = fromName.split('/');
    let [toPublisher, toPackage] = values.as!.split('/');
    if (!fromPublisher || !fromPackage || !toPublisher || !toPackage) {
      fail('--from and --as are <publisher>/<package>');
    }
    let result = await forkDeck({
      depotDir: depot.dir,
      storeDir: depot.storeDir,
      from: { publisher: fromPublisher, package: fromPackage, spec: fromSpec },
      to: { publisher: toPublisher, package: toPackage },
      force: values.force,
    });
    console.log(
      `forked ${result.from} → ${result.to} (${result.files.length} files) at ${result.dir}`,
    );
    console.log(
      `  it publishes under ${result.to}; ${fromName}'s versions never move`,
    );
    if (!values['use-in']) {
      return;
    }
    let [usePublisher, usePackage] = values['use-in'].split('/');
    if (!usePublisher || !usePackage) {
      fail('--use-in is <publisher>/<package>');
    }
    let mapPath = join(depot.dir, usePublisher, usePackage, 'importmap.json');
    let map = JSON.parse(await readFile(mapPath, 'utf8'));
    let vendor = (map.deck ??= {});
    let dependencies = (vendor.dependencies ??= {}) as Record<string, string>;
    // ALIAS, not rename: the key stays the import specifier the consumer
    // already writes, and the value says the fork answers to it. Renaming
    // the key would make every `import … from '<base>'` in the consumer's
    // own source wrong, which is the friction a fork is supposed to remove.
    //
    // The entry to repoint is found by what it TARGETS, not by its key: a
    // vendored library is usually already aliased (`"leaflet":
    // "lib/leaflet@1.9.4"`), and matching on the key alone would add a
    // second, unused `lib/leaflet` entry and leave `leaflet` pointing at
    // the original.
    let existingKey = Object.entries(dependencies).find(
      ([key, value]) =>
        key === fromName || parseDependencyValue(value).target === fromName,
    )?.[0];
    // `live` on purpose: the point of a fork is to see every save.
    dependencies[existingKey ?? fromName] = `${result.to}@live`;
    await writeFile(mapPath, JSON.stringify(map, null, 2) + '\n');
    let locked = await lockDeck({
      depotDir: depot.dir,
      depotName: depot.name,
      storeDir: depot.storeDir,
      deckDir: join(depot.dir, usePublisher, usePackage),
    });
    await writeFile(mapPath, locked.text);
    console.log(
      `  ${values['use-in']} now gets ${result.to} live wherever it imports ${fromName} — every save, no publish`,
    );
  },
});

// One implementation, two verbs. `offers` reports and never writes;
// `rebase` writes the clean merges. Keeping them as one command would hide
// which of the two you are running, and that is the difference between
// looking at contributor work and changing it.
async function runPass(
  command: 'offers' | 'rebase',
  argv: string[],
): Promise<void> {
  let { values } = parseArgs({
    args: argv,
    options: {
      depot: { type: 'string' },
      onto: { type: 'string' },
      check: { type: 'boolean', default: false },
      json: { type: 'boolean', default: false },
    },
  });
  if (!values.depot) {
    fail(`usage: deck ${command} --depot <dir> [--onto <spec>]`);
  }
  let dryRun = command === 'offers' || values.check;
  let result = await rebasePass({
    depot: depotAt(values.depot!),
    onto: values.onto,
    dryRun,
    onError: (error) => console.error(`  ${error}`),
  });
  if (values.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  if (result.outcomes.length === 0) {
    console.log('no open offers (no deck in this depot records a base)');
    return;
  }
  for (let outcome of result.outcomes) {
    let target = outcome.upstreamVersion
      ? `${outcome.upstream}@${outcome.upstreamVersion}`
      : outcome.upstream;
    let note =
      outcome.state === 'conflicted'
        ? `  conflicts: ${outcome.conflicts.join(', ')}`
        : outcome.detail
          ? `  ${outcome.detail}`
          : outcome.applied
            ? '  (written)'
            : '';
    console.log(`${outcome.state.padEnd(12)} ${outcome.offer} ← ${target}${note}`);
  }
  console.log(
    dryRun
      ? `${result.outcomes.length} open, ${result.conflicted} need a person`
      : `${result.rebased} rebased, ${result.conflicted} need a person`,
  );
  if (dryRun && values.check && result.conflicted > 0) {
    process.exit(1);
  }
}

const offers = defineCommand({
  name: 'offers',
  group: 'propose',
  summary: 'every open proposal, and whether it still merges with upstream',
  usage: ['offers --depot <dir> [--onto <spec>] [--json]'],
  detail: `Reports only — nothing is written. A maintainer with 200 open
proposals wants to see the three that stopped merging, not the 197 that
someone should rebase.`,
  run: (argv) => runPass('offers', argv),
});

const rebase = defineCommand({
  name: 'rebase',
  group: 'propose',
  summary: 're-merge every proposal against upstream; write the clean ones',
  usage: ['rebase --depot <dir> [--onto <spec>] [--check]'],
  detail: `Nobody rebases by hand. The base is exact and both sides are
content-addressed, so re-merging is a pure function a machine can run: clean
merges are written into the proposal's own tree — which auto-publishes and
seals like any other save — and the base pointer moves to what it absorbed.

Conflicted proposals are reported and left STRICTLY alone. A machine never
damages a contributor's work, so a conflicted merge writes nothing at all,
not even the part that merged.

JSON is merged as data rather than as lines: in a pretty-printed object,
adding a key makes the line above grow a comma, and a line merge would call
that a conflict. --check reports and exits nonzero if any proposal needs a
person, which is the CI shape. \`deck serve --rebase\` runs this pass
continuously.`,
  run: (argv) => runPass('rebase', argv),
});

export const PROPOSE_COMMANDS: Command[] = [fork, offers, rebase];
