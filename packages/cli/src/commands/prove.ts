// The executable contract.
//
// An implementation implements Deck by passing this suite, not by reading
// docs/deck-laws.md. The laws file exists so a human can tell what the suite
// is protecting.

import { parseArgs } from 'node:util';
import { formatReport } from '@deck/conformance/laws';
import { runConformance } from '@deck/conformance/run';
import { defineCommand, type Command } from '../command.ts';

const conform = defineCommand({
  name: 'conform',
  group: 'prove',
  summary: 'run the twelve laws against an implementation',
  usage: [
    'conform [--url <base> --depot <name>] [--at-rest] [--http] [--json]',
  ],
  detail: `With no --url it stands the canonical fixture depot up on the
reference server and measures that. With one it measures ANY implementation
black-box over HTTP — which is how the Boxel realm server will show that it
implements Deck.

--at-rest and --http select half the suite; neither flag means both.`,
  async run(argv) {
    let { values } = parseArgs({
      args: argv,
      options: {
        url: { type: 'string' },
        depot: { type: 'string' },
        'at-rest': { type: 'boolean', default: false },
        http: { type: 'boolean', default: false },
        json: { type: 'boolean', default: false },
      },
    });
    // Neither flag means both halves; either means only that half.
    let both = !values['at-rest'] && !values.http;
    let report = await runConformance({
      atRest: both || values['at-rest'],
      http: both || values.http,
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
