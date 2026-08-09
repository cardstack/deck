import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { DECK_DIR } from '@cardstack/deck-server/depot';
import { parsePolicy, POLICY_FILE, type CooldownPolicy } from './npm.ts';

// The depot's cooldown policy, if it declares one. Absent means the default.
//
// This used to sit in the server's `depot.ts`, which made the server import
// the npm layer for a file it never acts on. The server does not vendor, so
// it has no use for a policy about vendoring; the only readers are `deck
// depend` and the vendoring tools themselves. Reading it here costs the
// server an import it did not want and costs Tools nothing — Tools already
// knows the depot layout, because the rebase daemon runs against a mounted
// depot.

export async function readDepotPolicy(
  depotDir: string,
): Promise<Partial<CooldownPolicy>> {
  try {
    return parsePolicy(
      await readFile(join(depotDir, DECK_DIR, POLICY_FILE), 'utf8'),
    );
  } catch {
    return {};
  }
}
