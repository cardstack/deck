import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { packFromDir } from '@deck/core/pack';
import { publishToStore } from '@deck/core/store';
import { createDeckServer } from '@deck/server/server';
import { storeDirFor } from '@deck/server/realm';
import { runAtRestChecks } from './at-rest.ts';
import { runHttpChecks, type HttpTarget } from './over-http.ts';
import { summarize, type ConformanceReport } from './laws.ts';
import {
  FIXTURE_PACKAGE,
  FIXTURE_PUBLISHER,
  FIXTURE_REALM,
  FIXTURE_VERSION,
  writeFixtureRealm,
} from './fixture.ts';

export interface RunOptions {
  atRest?: boolean;
  // Measure a server someone else is running. Without this, the reference
  // server is started on a temporary realm and measured instead.
  target?: HttpTarget;
  http?: boolean;
  port?: number;
}

// Stand the fixture realm up and serve it, so `deck conform` needs no setup.
// The same fixture written to disk anywhere else, published the same way,
// makes any other implementation measurable by the same run.
export async function withFixtureServer<T>(
  port: number,
  body: (target: HttpTarget) => Promise<T>,
): Promise<T> {
  let root = await mkdtemp(join(tmpdir(), 'deck-conform-http-'));
  let realmDir = await writeFixtureRealm(root);
  let deckDir = join(realmDir, FIXTURE_PUBLISHER, FIXTURE_PACKAGE);
  await publishToStore(
    storeDirFor(realmDir),
    `${FIXTURE_PUBLISHER}/${FIXTURE_PACKAGE}`,
    FIXTURE_VERSION,
    await packFromDir(deckDir),
    { tag: 'latest' },
  );
  let server = createDeckServer({
    realms: [{ name: FIXTURE_REALM, dir: realmDir, storeDir: storeDirFor(realmDir) }],
  });
  await new Promise<void>((resolve) => server.listen(port, resolve));
  try {
    let address = server.address();
    let actual = typeof address === 'object' && address ? address.port : port;
    return await body({
      baseUrl: `http://localhost:${actual}`,
      realm: FIXTURE_REALM,
    });
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(root, { recursive: true, force: true });
  }
}

export async function runConformance(
  options: RunOptions = {},
): Promise<ConformanceReport> {
  let { atRest = true, http = true, target, port = 0 } = options;
  let results = [];
  if (atRest) {
    results.push(...(await runAtRestChecks()));
  }
  if (http) {
    results.push(
      ...(target
        ? await runHttpChecks(target)
        : await withFixtureServer(port, (fixtureTarget) =>
            runHttpChecks(fixtureTarget),
          )),
    );
  }
  return summarize(results);
}
