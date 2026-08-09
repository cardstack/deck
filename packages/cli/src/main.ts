// The Deck CLI is the WRITE side of the standalone protocol: it arranges
// at-rest state (packs, the store). The server is read-only. Together they
// are the reference implementation any other implementor (the Boxel realm
// server included) must agree with byte-for-byte.
//
// This file is only the front door. Each command lives in src/commands/,
// grouped by what it is FOR — see src/command.ts for the eight groups, and
// src/registry.ts for the whole list.

import { help, suggestion } from './help.ts';
import { assertGroupsCovered, findCommand } from './registry.ts';
import { fail } from './support.ts';

// The URL slot standalone Deck stores into is a DEPOT, not a realm — "realm"
// is Boxel's word for something richer (see
// docs/deck-depot-and-realm-backport.md). The flag was renamed with the
// vocabulary; `--realm` keeps working so nothing anyone already scripted
// breaks silently, and says so once.
export function acceptLegacyRealmFlag(argv: string[]): string[] {
  let used = false;
  let next = argv.map((argument) => {
    if (argument === '--realm' || argument.startsWith('--realm=')) {
      used = true;
      return `--depot${argument.slice('--realm'.length)}`;
    }
    return argument;
  });
  if (used) {
    console.error('deck: --realm is now --depot (still accepted for now)');
  }
  return next;
}

async function main(): Promise<void> {
  assertGroupsCovered();
  let [name, ...argv] = acceptLegacyRealmFlag(process.argv.slice(2));
  if (name === undefined || name === 'help' || name === '--help' || name === '-h') {
    console.log(help(argv));
    return;
  }
  let command = findCommand(name);
  if (!command) {
    console.error(`deck: no command "${name}"${suggestion(name)}`);
    console.error("run `deck help` for the command map");
    process.exit(1);
  }
  await command!.run(argv);
}

main().catch((error: unknown) => {
  fail(String((error as Error)?.message ?? error));
});
