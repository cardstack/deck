// Things every command needs and no command should own.

import { basename, resolve } from 'node:path';
import { storeDirFor } from '@deck/server/depot';

export function fail(message: string): never {
  console.error(`error: ${message}`);
  process.exit(1);
}

// 8787 is jj-historyd's default; a deck server sharing a machine with one
// would collide silently, so the server sits next door.
export const DEFAULT_PORT = '8788';

// A depot is a directory, and its NAME — the first URL segment — is the
// directory's own name. That equivalence is the whole addressing story, so
// it is resolved in exactly one place.
export interface DepotRef {
  name: string;
  dir: string;
  storeDir: string;
}

export function depotAt(dir: string): DepotRef {
  let resolved = resolve(dir);
  return {
    name: basename(resolved),
    dir: resolved,
    storeDir: storeDirFor(resolved),
  };
}

// `--minimum-release-age` is pnpm's setting in pnpm's units (minutes);
// `--min-age-days` is the same dial for humans who think in days. Either
// overrides whatever the depot's policy.json declares.
export function cooldownOverride(values: {
  'minimum-release-age'?: string;
  'min-age-days'?: string;
}): { minimumReleaseAge?: number } {
  if (values['minimum-release-age'] !== undefined) {
    return { minimumReleaseAge: Number(values['minimum-release-age']) };
  }
  if (values['min-age-days'] !== undefined) {
    return { minimumReleaseAge: Number(values['min-age-days']) * 1440 };
  }
  return {};
}

interface Listenable {
  listen(port: number, callback: () => void): void;
  once(event: string, callback: (error: NodeJS.ErrnoException) => void): void;
  removeAllListeners(event: string): void;
}

// `deck hello` is a runme: a busy port is not something to make the reader
// solve. Explicit `--port` is honoured exactly; the default walks forward.
export async function listenNear(
  server: Listenable,
  port: number,
  attempts = 10,
): Promise<number> {
  for (let candidate = port; candidate < port + attempts; candidate++) {
    let listening = await new Promise<boolean>((resolve) => {
      server.once('error', (error: NodeJS.ErrnoException) => {
        if (error.code === 'EADDRINUSE') {
          resolve(false);
        } else {
          throw error;
        }
      });
      server.listen(candidate, () => resolve(true));
    });
    server.removeAllListeners('error');
    if (listening) {
      return candidate;
    }
  }
  throw new Error(`no free port in ${port}..${port + attempts - 1}`);
}
