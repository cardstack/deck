import QUnit from 'qunit';
const { module, test } = QUnit;
import { connect } from 'node:http2';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { createDeckServer, type DeckServer } from '../src/server.ts';
import { ensureDevTlsMaterials, localFetch } from '../src/tls.ts';

module('HTTP/2 over TLS', (hooks) => {
  let root: string;
  let server: DeckServer;
  let origin: string;

  hooks.before(async () => {
    root = await mkdtemp(join(tmpdir(), 'deck-http2-'));
    let tlsDir = join(root, 'certs');
    let materials = ensureDevTlsMaterials(tlsDir);
    server = createDeckServer({
      depots: [],
      tls: materials,
      fallback: (_req, res) => {
        res.writeHead(200, { 'content-type': 'text/plain' });
        res.end('ok');
      },
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    let port = (server.address() as AddressInfo).port;
    origin = `https://127.0.0.1:${port}`;
  });

  hooks.after(async () => {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
    await rm(root, { recursive: true, force: true });
  });

  test('createDeckServer({ tls }) reports https', (assert) => {
    assert.strictEqual(server.protocol, 'https');
  });

  test('browsers get an HTTP/2 session', async (assert) => {
    let done = assert.async();
    let client = connect(origin, { rejectUnauthorized: false });
    client.on('error', (error) => {
      assert.true(false, String(error));
      done();
    });
    let req = client.request({ ':path': '/' });
    let status: string | number | undefined;
    req.on('response', (headers) => {
      status = headers[':status'];
    });
    let body = '';
    req.setEncoding('utf8');
    req.on('data', (chunk) => {
      body += chunk;
    });
    req.on('end', () => {
      assert.strictEqual(status, 200);
      assert.strictEqual(body, 'ok');
      assert.strictEqual(client.alpnProtocol, 'h2');
      client.close();
      done();
    });
    req.end();
  });

  test('localFetch trusts the demo leaf for loopback probes', async (assert) => {
    let response = await localFetch(`${origin}/`);
    assert.strictEqual(response.status, 200);
    assert.strictEqual(await response.text(), 'ok');
  });
});
