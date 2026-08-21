#!/usr/bin/env node
// VALE sample sale — one live branch, History seals, no releases.
//
//   pnpm --filter @cardstack/deck-example-vale-sale demo
//   open the printed /site/vale/sale/index.html
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createDemoServer,
  demoOrigin,
  liveNotes,
  openDemoDepot,
  serveLive,
} from '../shared/depot.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT ?? 8799);
const depotDir = join(here, 'depot');

const depot = await openDemoDepot({ name: 'site', dir: depotDir });
const server = createDemoServer({ depots: [depot] });
serveLive({ depot, server });
server.listen(PORT, () => {
  let origin = demoOrigin(PORT);
  console.log(`\n  VALE sample sale`);
  console.log(`  ${origin}/site/vale/sale/index.html\n`);
  for (let line of liveNotes({ depot, port: PORT, origin })) console.log(line);
});
