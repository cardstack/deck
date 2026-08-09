#!/usr/bin/env node
// Remix — a fork that copies nothing.
//
// `catalog/notes-app` is a small app in four modules, published and sealed
// at 1.0.0. `you/my-notes` is a remix of it. The remix consists of:
//
//     importmap.json   { "deck": { "extends": "catalog/notes-app@1.0.0" },
//                        "imports": { "notes/theme": "./theme.js" } }
//     theme.js         six lines of colour
//     index.html       a page to load it from
//
// That is the whole thing. `app.js`, `list.js` and `item.js` are not copied,
// not forked, and not present — they resolve to the catalog's sealed
// Version, at URLs the browser may already hold from the parent page.
//
// Open both pages. The app renders in two different skins, and each page
// prints the import map the server actually injected: four entries on both,
// three of them identical.
//
// The point is what did NOT happen. There is no second copy of the app to
// keep in step with upstream, and no merge to do when 1.1.0 arrives — the
// remix moves by editing one line of `extends`.
//
//   pnpm --filter @cardstack/deck-example-remix demo
//   open http://localhost:8800/
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readdir, stat } from 'node:fs/promises';
import { packFromDir } from '@cardstack/deck/pack';
import { publishToStore, readStoreMeta } from '@cardstack/deck/store';
import { storeDirFor } from '@cardstack/deck-server/depot';
import { createDemoServer, demoOrigin } from '../shared/depot.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT ?? 8800);
const depotDir = join(here, 'depot');
const storeDir = storeDirFor(depotDir);

const PARENT = { deck: 'catalog/notes-app', version: '1.0.0' };
const REMIX = 'you/my-notes';

async function bytesIn(dir) {
  let total = 0;
  for (let name of await readdir(dir)) {
    total += (await stat(join(dir, name))).size;
  }
  return total;
}

// The parent has to be SEALED before anything can inherit from it. L4 is the
// only reason `extends` is safe: a child pinned to 1.0.0 keeps meaning what
// it meant, however far the catalog moves on.
let meta = await readStoreMeta(storeDir, PARENT.deck);
if (!meta?.versions[PARENT.version]) {
  await publishToStore(
    storeDir,
    PARENT.deck,
    PARENT.version,
    await packFromDir(join(depotDir, ...PARENT.deck.split('/'))),
    { tag: 'latest' },
  );
}

let parentBytes = await bytesIn(join(depotDir, ...PARENT.deck.split('/')));
let remixBytes = await bytesIn(join(depotDir, ...REMIX.split('/')));

const server = createDemoServer({
  depots: [{ name: 'site', dir: depotDir, storeDir }],
  fallback: (req, res) => {
    res.writeHead(302, { location: `/site/${REMIX}/index.html` });
    res.end();
  },
});

server.listen(PORT, () => {
  let origin = demoOrigin(PORT);
  console.log(`
  remix — a fork that copies nothing

     the app   ${PARENT.deck}@${PARENT.version}  ${parentBytes} bytes, 4 modules
     the remix ${REMIX}  ${remixBytes} bytes, 1 override

     parent    ${origin}/site/catalog/notes-app@1.0.0/index.html
     remix     ${origin}/site/${REMIX}/index.html

  Both pages print the import map they were served. Three of the four
  entries are the same URL — the remix inherited them by reference.

  serving`);
});
