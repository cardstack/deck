import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { packFromDir } from '@cardstack/deck/pack';
import { publishToStore } from '@cardstack/deck/store';
import { createDeckServer } from '@cardstack/deck-server/server';
import { storeDirFor } from '@cardstack/deck-server/depot';
import { runAtRestChecks } from './at-rest.ts';
import { runHttpChecks, type HttpTarget } from './over-http.ts';
import { runRRIChecks } from './rri.ts';
import { summarize, type ConformanceReport } from './laws.ts';
import {
  FIXTURE_PACKAGE,
  FIXTURE_PUBLISHER,
  FIXTURE_DEPOT,
  FIXTURE_VERSION,
  GRAPH_PUBLISHER,
  GRAPH_VERSION,
  graphFixtureDecks,
  writeFixtureDepot,
} from './fixture.ts';

export interface RunOptions {
  rri?: boolean;
  atRest?: boolean;
  // Measure a server someone else is running. Without this, the reference
  // server is started on a temporary depot and measured instead.
  target?: HttpTarget;
  http?: boolean;
  port?: number;
}

// Stand the fixture depot up and serve it, so `deck conform` needs no setup.
// The same fixture written to disk anywhere else, published the same way,
// makes any other implementation measurable by the same run.
export async function withFixtureServer<T>(
  port: number,
  body: (target: HttpTarget) => Promise<T>,
): Promise<T> {
  let root = await mkdtemp(join(tmpdir(), 'deck-conform-http-'));
  let depotDir = await writeFixtureDepot(root);
  let deckDir = join(depotDir, FIXTURE_PUBLISHER, FIXTURE_PACKAGE);
  await publishToStore(
    storeDirFor(depotDir),
    `${FIXTURE_PUBLISHER}/${FIXTURE_PACKAGE}`,
    FIXTURE_VERSION,
    await packFromDir(deckDir),
    { tag: 'latest' },
  );
  // The scoped graph is three decks, and it has to be sealed for the preload
  // check to mean anything: the closure is advertised only for a sealed
  // document, because a live one can change between the walk and the fetch.
  for (let { pkg } of graphFixtureDecks(FIXTURE_DEPOT)) {
    await publishToStore(
      storeDirFor(depotDir),
      `${GRAPH_PUBLISHER}/${pkg}`,
      GRAPH_VERSION,
      await packFromDir(join(depotDir, GRAPH_PUBLISHER, pkg)),
      { tag: 'latest' },
    );
  }
  let server = createDeckServer({
    depots: [{ name: FIXTURE_DEPOT, dir: depotDir, storeDir: storeDirFor(depotDir) }],
  });
  await new Promise<void>((resolve) => server.listen(port, resolve));
  try {
    let address = server.address();
    let actual = typeof address === 'object' && address ? address.port : port;
    return await body({
      baseUrl: `http://localhost:${actual}`,
      depot: FIXTURE_DEPOT,
    });
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(root, { recursive: true, force: true });
  }
}

export async function runConformance(
  options: RunOptions = {},
): Promise<ConformanceReport> {
  let { rri = true, atRest = true, http = true, target, port = 0 } = options;
  let results = [];
  if (rri) {
    results.push(...(await runRRIChecks()));
  }
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
