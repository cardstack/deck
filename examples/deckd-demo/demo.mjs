#!/usr/bin/env node
// Seed + serve the deckd-demo depot. Prefer DECKD_URL / --history deckd.
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { packFromDir, publishToStore } from '@cardstack/deck/node';
import {
  createDemoServer,
  demoOrigin,
  openDemoDepot,
  serveLive,
} from '../shared/depot.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const depotDir = join(here, 'depot');
const PORT = Number(process.env.PORT ?? 8810);

await mkdir(join(depotDir, 'demo', 'hello'), { recursive: true });
await writeFile(
  join(depotDir, 'demo', 'hello', 'hello.js'),
  `export const greeting = 'hello from deckd-demo';\nexport const builtAt = ${JSON.stringify(
    new Date().toISOString(),
  )};\n`,
);

const depot = await openDemoDepot({ name: 'site', dir: depotDir });
const packed = await packFromDir(join(depotDir, 'demo', 'hello'));
await publishToStore(depot.storeDir, 'demo', 'hello', '1.0.0', packed);
console.log('   published demo/hello@1.0.0');

const server = createDemoServer({ depots: [depot] });
serveLive({ depot, server });
server.listen(PORT, () => {
  console.log(`\n  deckd-demo  ${demoOrigin(PORT)}/site/demo/hello@1.0.0/hello.js\n`);
});
