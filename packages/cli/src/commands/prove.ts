// The executable contract.
//
// An implementation implements Deck by passing this suite, not by reading
// docs/deck-laws.md. The laws file exists so a human can tell what the suite
// is protecting.

import { parseArgs } from 'node:util';
import { join } from 'node:path';
import { formatReport } from '@deck/conformance/laws';
import { runConformance } from '@deck/conformance/run';
import {
  GOLDEN_PATH,
  exportFixture,
  goldenFixture,
} from '@deck/conformance/export';
import { defineCommand, type Command } from '../command.ts';

const conform = defineCommand({
  name: 'conform',
  group: 'prove',
  summary: 'run the twelve laws against an implementation',
  usage: [
    'conform [--url <base> --depot <name>] [--at-rest] [--http] [--json]',
    'conform --export <dir>',
  ],
  detail: `With no --url it stands the canonical fixture depot up on the
reference server and measures that. With one it measures ANY implementation
black-box over HTTP — which is how the Boxel realm server will show that it
implements Deck.

--export writes the fixture tree and golden.json to a directory, for an
implementation that cannot call this library: publish the tree under the
names in golden.json, serve it, then point --url at it.

--at-rest and --http select half the suite; neither flag means both. With
--url, at-rest is OFF unless you ask for it — those checks call this
library, so against a foreign target they measure the wrong thing.`,
  async run(argv) {
    let { values } = parseArgs({
      args: argv,
      options: {
        url: { type: 'string' },
        depot: { type: 'string' },
        export: { type: 'string' },
        'at-rest': { type: 'boolean', default: false },
        http: { type: 'boolean', default: false },
        json: { type: 'boolean', default: false },
      },
    });

    if (values.export) {
      let depotDir = await exportFixture(values.export);
      console.log(`fixture depot   ${depotDir}`);
      console.log(`golden values   ${join(values.export, GOLDEN_PATH)}`);
      console.log(
        `\nPublish the tree under the names in golden.json, serve it, then:\n  ${goldenFixture().verify}`,
      );
      return;
    }

    // Neither flag means both halves; either means only that half.
    //
    // Except against a foreign target. The at-rest checks call @deck/core
    // directly, so they measure THIS library however the target behaves —
    // and a run that reports them alongside the HTTP results reads as
    // "38 checks passed" when only the HTTP half touched the thing under
    // test. A conformance tool that flatters its target is worse than none.
    let both = !values['at-rest'] && !values.http;
    let atRest = values.url ? values['at-rest'] : both || values['at-rest'];
    if (values.url && atRest) {
      console.log(
        'note: --at-rest measures this library, not the server at --url.\n',
      );
    }
    let report = await runConformance({
      atRest,
      http: values.url ? true : both || values.http,
      ...(values.url
        ? { target: { baseUrl: values.url, depot: values.depot ?? 'conformance' } }
        : {}),
    });
    console.log(
      values.json ? JSON.stringify(report, null, 2) : formatReport(report),
    );
    if (report.failed > 0) {
      process.exitCode = 1;
    }
  },
});

export const PROVE_COMMANDS: Command[] = [conform];
