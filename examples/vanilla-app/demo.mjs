// Safe-vendor demo: review a library once, publish it into your own store,
// serve it immutably — the app never touches a public CDN.
//
//   node examples/vanilla-app/demo.mjs
//   open http://localhost:8787/
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { packFromDir } from '@deck/core/pack';
import { publishToStore } from '@deck/core/store';
import { createDeckServer } from '@deck/server/server';

const here = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT ?? 8787);

// 1. "Review" + pack + publish the vendored library (an agent or a human
//    does this once per approved version).
let storeDir = await mkdtemp(join(tmpdir(), 'deck-demo-store-'));
let packBytes = await packFromDir(join(here, 'lib', 'confetti'), {
  createdBy: 'demo',
  sourceRealm: 'examples/vanilla-app/lib/confetti',
});
let { treeHash } = await publishToStore(
  storeDir,
  'confetti',
  '1.0.0',
  packBytes,
  { tag: 'latest' },
);
console.log(`published confetti@1.0.0 (treeHash ${treeHash})`);

// 2. Serve: the Deck routes handle /@confetti@...; the fallback serves the
//    demo page itself. One origin, zero external hosts.
const STATIC_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
};
let server = createDeckServer({
  storeDir,
  fallback: async (req, res) => {
    let path = req.url === '/' ? '/index.html' : (req.url ?? '/');
    try {
      let bytes = await readFile(join(here, 'app', ...path.split('/')));
      res.writeHead(200, {
        'content-type':
          STATIC_TYPES[extname(path)] ?? 'application/octet-stream',
      });
      res.end(bytes);
    } catch {
      res.writeHead(404, { 'content-type': 'text/plain' });
      res.end('not found');
    }
  },
});
server.listen(PORT, () => {
  console.log(`deck safe-vendor demo: http://localhost:${PORT}/`);
  console.log(`try also:`);
  console.log(`  http://localhost:${PORT}/_packages/confetti`);
  console.log(`  http://localhost:${PORT}/@confetti@1.0.0?meta`);
  console.log(`  http://localhost:${PORT}/@confetti@latest`);
  console.log(`  http://localhost:${PORT}/@confetti@1.0.0?format=pack`);
});
