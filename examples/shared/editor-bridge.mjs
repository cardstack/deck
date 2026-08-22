// A stand-in for your text editor.
//
// READ THIS BEFORE COPYING IT. This is not part of Deck, and it is on its
// own port for a reason you can check: the deck server answers GET and HEAD
// and nothing else (L12). A browser cannot write to it. Try it and you get
// `405 method-not-allowed` from the read-only gate in
// `packages/server/src/server.ts`, before any route runs.
//
// So a demo that wants the reader to make an edit has exactly two choices:
// tell them to open the file in an editor, or run a second process that puts
// bytes on disk on their behalf. This is the second one. It writes one file
// and stops. It publishes nothing, hashes nothing and knows nothing about
// versions — the watcher on the deck server does all of that, from the file,
// exactly as it would if the bytes had arrived from vim.
//
// The boundary is the point. Everything after the write is the real system.

import { createServer } from 'node:http';
import { createSecureServer } from 'node:http2';
import { cp, readFile, stat, writeFile } from 'node:fs/promises';
import { join, normalize } from 'node:path';
import { resolveTlsMaterials } from '@cardstack/deck-server/tls';
import { DEMO_TLS } from './depot.mjs';

const MAX_BYTES = 64 * 1024;

function body(req) {
  return new Promise((resolve, reject) => {
    let chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BYTES) {
        reject(new Error(`over ${MAX_BYTES} bytes`));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

/**
 * Read an example's editable-file declaration, if it has one.
 *
 * The declaration is data in the example directory, so the example's own
 * demo.mjs and the Hub start the same bridge over the same allow-list
 * instead of each keeping its own copy of the list.
 */
export async function readEditable(exampleDir) {
  try {
    let text = await readFile(join(exampleDir, 'editable.json'), 'utf8');
    let declared = JSON.parse(text);
    return Object.keys(declared.files ?? {}).length > 0 ? declared : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Copy an example's `starter/` tree into its depot, once.
 *
 * The seeded directory is gitignored, so an edit made in the browser never
 * dirties the repository — and it is only copied when absent, so a re-run
 * keeps whatever the last reader left behind.
 */
export async function seedEditable(exampleDir, declared) {
  if (!declared?.seed) return 'none';
  let from = join(exampleDir, declared.seed);
  let seeded = [];
  for (let relative of Object.values(declared.files)) {
    let target = join(exampleDir, 'depot', relative.split('/').slice(0, -1).join('/'));
    if (await stat(target).then(() => true).catch(() => false)) continue;
    await cp(join(from, target.split('/').at(-1)), target, { recursive: true });
    seeded.push(relative);
  }
  return seeded.length > 0 ? 'seeded' : 'kept';
}

/**
 * Build a listener-free write endpoint for a fixed, named set of files.
 *
 * `files` is the allow-list: `{ '<id>': '<path under depotDir>' }`. A
 * request names an id, never a path, so the browser cannot choose what to
 * overwrite. The bytes each file started with are read once at boot, so
 * `revert` always has something true to go back to.
 *
 *   GET  /files            → { id: { path, text, original } }
 *   POST /write            { id, text }   → { ok: true, bytes }
 *   POST /revert           { id }         → { ok: true, text }
 *
 * @param {object} options
 * @param {string} options.depotDir
 * @param {Record<string,string>} options.files
 */
export async function createEditorBridge({ depotDir, files }) {
  let originals = new Map();
  for (let [id, relative] of Object.entries(files)) {
    originals.set(id, await readFile(join(depotDir, relative), 'utf8'));
  }

  function pathFor(id) {
    let relative = files[id];
    if (!relative) return undefined;
    // The allow-list already decided this, so normalize() is belt and braces
    // rather than the check itself.
    let full = normalize(join(depotDir, relative));
    return full.startsWith(normalize(depotDir)) ? full : undefined;
  }

  async function respond(req, res) {
    // One origin, one method, three routes. A demo bridge that grows a
    // fourth route is a write API, and this must never become one.
    res.setHeader('access-control-allow-origin', '*');
    res.setHeader('access-control-allow-headers', 'content-type');
    res.setHeader('cache-control', 'no-store');
    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    let path = new URL(req.url ?? '/', 'http://localhost').pathname;
    let json = (status, payload) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(payload));
    };

    try {
      if (req.method === 'GET' && path === '/files') {
        let out = {};
        for (let [id, relative] of Object.entries(files)) {
          out[id] = {
            path: relative,
            text: await readFile(pathFor(id), 'utf8'),
            original: originals.get(id),
          };
        }
        json(200, out);
        return;
      }

      if (req.method === 'POST' && path === '/write') {
        let { id, text } = JSON.parse(await body(req));
        let full = pathFor(id);
        if (!full) return json(404, { error: `not editable: ${id}` });
        if (typeof text !== 'string') return json(400, { error: 'text' });
        await writeFile(full, text, 'utf8');
        json(200, { ok: true, bytes: Buffer.byteLength(text) });
        return;
      }

      if (req.method === 'POST' && path === '/revert') {
        let { id } = JSON.parse(await body(req));
        let full = pathFor(id);
        if (!full) return json(404, { error: `not editable: ${id}` });
        let text = originals.get(id);
        await writeFile(full, text, 'utf8');
        json(200, { ok: true, text });
        return;
      }

      json(404, { error: 'no such route' });
    } catch (error) {
      json(400, { error: String(error?.message ?? error) });
    }
  }

  return { respond };
}

/**
 * Give a standalone example its own editor listener. The Hub instead mounts
 * `createEditorBridge()` behind its one virtual-host listener.
 *
 * @param {object} options
 * @param {string} options.depotDir
 * @param {Record<string,string>} options.files
 * @param {number} options.port 0 asks the kernel for a free one
 * @param {boolean} [options.tls] defaults to whatever the demo uses
 */
export async function startEditorBridge({ depotDir, files, port, tls: wantTls }) {
  let { respond } = await createEditorBridge({ depotDir, files });
  let secure = wantTls ?? DEMO_TLS;
  let tls = secure ? resolveTlsMaterials(true) : undefined;
  let server = tls
    ? createSecureServer({ cert: tls.cert, key: tls.key, allowHTTP1: true }, respond)
    : createServer(respond);

  // Port 0 asks the kernel for whatever is free, which is the only way to
  // ask that has no race in it. The caller learns the answer from the
  // listener, never from the number it passed in.
  await new Promise((resolve) => server.listen(port, resolve));
  let bound = server.address().port;
  return {
    server,
    port: bound,
    origin: `${secure ? 'https' : 'http'}://localhost:${bound}`,
  };
}
