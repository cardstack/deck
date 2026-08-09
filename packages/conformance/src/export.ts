// Handing the fixture to an implementation that is not this one.
//
// `withFixtureServer` builds the fixture by calling into `@deck/core`, which
// is fine for measuring the reference server and useless for measuring
// anything else. An implementation written in another language cannot call a
// TypeScript function — it needs the bytes and the answers.
//
// So: write the fixture tree to a directory, and write down what a correct
// implementation must produce from it. Publish the tree into your own store
// under the names in `golden.json`, serve it, and point `deck conform --url`
// at the result.
//
// The golden values are the part that makes the comparison meaningful rather
// than self-referential. Without them an implementation could hash the
// fixture its own way, serve it consistently, and pass — having agreed only
// with itself.

import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { hashBytes } from '@deck/core/tree-hash';
import {
  FIXTURE_DEPOT,
  FIXTURE_PACKAGE,
  FIXTURE_PUBLISHER,
  FIXTURE_TREE_HASH,
  FIXTURE_VERSION,
  GRAPH_PUBLISHER,
  GRAPH_VERSION,
  fixtureFiles,
  graphFixtureDecks,
  writeFixtureDepot,
} from './fixture.ts';

export const GOLDEN_PATH = 'golden.json';
export const GOLDEN_FORMAT = 'deck-conformance-fixture-v1';

export interface GoldenFixture {
  format: typeof GOLDEN_FORMAT;
  /** Publish the tree under exactly these names, or the URLs the suite
   *  requests will not exist. */
  install: {
    depot: string;
    publisher: string;
    package: string;
    version: string;
    tag: string;
  };
  /** What a correct implementation must compute from the tree it was
   *  given. Disagree here and nothing downstream is worth checking. */
  expect: {
    treeHash: string;
    files: { path: string; size: number; sha256: string }[];
  };
  /** Also publish these, sealed: the preload closure is only advertised for
   *  a sealed document, so an unsealed graph makes that check vacuous. */
  graph: { publisher: string; package: string; version: string }[];
  /** Then run this. */
  verify: string;
}

export function goldenFixture(): GoldenFixture {
  return {
    format: GOLDEN_FORMAT,
    install: {
      depot: FIXTURE_DEPOT,
      publisher: FIXTURE_PUBLISHER,
      package: FIXTURE_PACKAGE,
      version: FIXTURE_VERSION,
      tag: 'latest',
    },
    expect: {
      treeHash: FIXTURE_TREE_HASH,
      files: fixtureFiles().map((file) => ({
        path: file.path,
        size: file.bytes.length,
        sha256: hashBytes(file.bytes),
      })),
    },
    graph: graphFixtureDecks(FIXTURE_DEPOT).map(({ pkg }) => ({
      publisher: GRAPH_PUBLISHER,
      package: pkg,
      version: GRAPH_VERSION,
    })),
    verify: `deck conform --url <your-base-url> --depot ${FIXTURE_DEPOT}`,
  };
}

/**
 * Write the fixture tree and its golden values into `dir`.
 *
 * Returns the path of the depot directory that was written.
 */
export async function exportFixture(dir: string): Promise<string> {
  let depotDir = await writeFixtureDepot(dir);
  await writeFile(
    join(dir, GOLDEN_PATH),
    JSON.stringify(goldenFixture(), null, 2) + '\n',
    'utf8',
  );
  return depotDir;
}
