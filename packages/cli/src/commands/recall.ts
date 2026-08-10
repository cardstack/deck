// Going back.
//
// Tier 1 is always on: every settled save auto-publishes an immutable
// version, so the store alone can return you to any published state. Tier 2
// adds a seal per SAVE — the states between publishes — through jj or
// historyd. When neither is available the commands here say so and stop,
// rather than pretending a partial answer is the whole log.

import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { applyRestore } from '@cardstack/deck-history/backend';
import { createHistory, isValidHistoryKind } from '@cardstack/deck-history/create';
import { defineCommand, type Command } from '../command.ts';
import { fail } from '../support.ts';

const history = defineCommand({
  name: 'history',
  group: 'recall',
  summary: "list a depot's seals — every state it has been in",
  usage: ['history <depot-dir> [--limit <n>] [--json]'],
  detail: `Listing flushes first: whatever is on disk right now is sealed
before it is reported, so the log is never behind the tree.`,
  async run(argv) {
    let { values, positionals } = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        limit: { type: 'string', default: '20' },
        json: { type: 'boolean', default: false },
        history: { type: 'string', default: 'auto' },
      },
    });
    let [dir] = positionals;
    if (!dir) fail('usage: deck history <dir> [--limit <n>] [--json]');
    if (!isValidHistoryKind(values.history!)) {
      fail('--history must be auto, jj, historyd, deckd, or none');
    }
    let attachment = await createHistory({
      dir: resolve(dir!),
      kind: values.history,
    });
    if (!attachment.backend) {
      fail(`${attachment.detail} — no seals to list`);
    }
    let seals = await attachment.backend!.list(resolve(dir!));
    attachment.backend!.close();
    if (values.json) {
      console.log(JSON.stringify(seals, null, 2));
      return;
    }
    if (seals.length === 0) {
      console.log('no seals yet — save a file');
      return;
    }
    for (let seal of seals.slice(0, Number(values.limit))) {
      console.log(
        `${seal.changeId.slice(0, 12)}  ${seal.timestamp}  ${seal.description}${
          seal.author ? ` (${seal.author})` : ''
        }`,
      );
      for (let line of seal.filesSummary) {
        console.log(`              ${line}`);
      }
    }
    if (seals.length > Number(values.limit)) {
      console.log(`… ${seals.length - Number(values.limit)} more`);
    }
  },
});

const restore = defineCommand({
  name: 'restore',
  group: 'recall',
  summary: 'put the depot back to a sealed state',
  usage: ['restore <depot-dir> <changeId>'],
  detail: `The state you are leaving is sealed FIRST, so a restore is itself
undoable, and the restored state auto-publishes as the next dev version.
Nothing is rewound: a restore replays forward as ordinary writes, so history
only ever grows.`,
  async run(argv) {
    let { values, positionals } = parseArgs({
      args: argv,
      allowPositionals: true,
      options: { history: { type: 'string', default: 'auto' } },
    });
    let [dir, changeId] = positionals;
    if (!dir || !changeId) fail('usage: deck restore <dir> <changeId>');
    if (!isValidHistoryKind(values.history!)) {
      fail('--history must be auto, jj, historyd, deckd, or none');
    }
    let attachment = await createHistory({
      dir: resolve(dir!),
      kind: values.history,
    });
    if (!attachment.backend) {
      fail(`${attachment.detail} — nothing to restore from`);
    }
    let result = await applyRestore(
      attachment.backend!,
      resolve(dir!),
      changeId!,
    );
    attachment.backend!.close();
    console.log(
      `restored ${dir} to ${changeId}: ${result.written.length} file(s) written, ${result.deleted.length} removed`,
    );
    for (let path of [...result.written, ...result.deleted].slice(0, 10)) {
      console.log(`  ${path}`);
    }
    if (result.from) {
      console.log(
        `the state you left is sealed as ${result.from.slice(0, 12)} — restore it back any time`,
      );
    }
  },
});

export const RECALL_COMMANDS: Command[] = [history, restore];
