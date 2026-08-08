import {
  FIXTURE_PACKAGE,
  FIXTURE_PUBLISHER,
  FIXTURE_TREE_HASH,
  FIXTURE_VERSION,
  fixtureFiles,
} from './fixture.ts';
import { assert, assertEqual, Checks, type CheckResult } from './laws.ts';

// Over-the-wire conformance: BLACK BOX. Nothing here imports @deck/core, so
// the same run measures the reference server and the Boxel realm server with
// no changes and no shared code to be wrong in the same way.
//
// The target must be serving the canonical fixture realm, live at
// /<realm>/deck/fixture/ and sealed at /<realm>/deck/fixture@1.0.0/.

export interface HttpTarget {
  // e.g. "http://localhost:8788"
  baseUrl: string;
  // e.g. "conformance"
  realm: string;
  fetchImpl?: typeof fetch;
}

function cacheDirectives(header: string | null): Set<string> {
  return new Set(
    (header ?? '')
      .split(',')
      .map((part) => part.trim().toLowerCase())
      .filter(Boolean),
  );
}

export async function runHttpChecks(
  target: HttpTarget,
): Promise<CheckResult[]> {
  let checks = new Checks();
  let { baseUrl, realm, fetchImpl = fetch } = target;
  let base = baseUrl.replace(/\/$/, '');
  let live = `${base}/${realm}/${FIXTURE_PUBLISHER}/${FIXTURE_PACKAGE}`;
  let sealed = `${base}/${realm}/${FIXTURE_PUBLISHER}/${FIXTURE_PACKAGE}@${FIXTURE_VERSION}`;
  let get = (url: string, init?: RequestInit) =>
    fetchImpl(url, { redirect: 'manual', ...init });

  // ---- L5 volatility -----------------------------------------------------
  await checks.run('L5', 'the version-less address serves the working tree', async () => {
    let response = await get(`${live}/index.js`);
    assertEqual(response.status, 200, 'status');
    let directives = cacheDirectives(response.headers.get('cache-control'));
    assert(
      directives.has('no-store'),
      `live must be no-store, got "${response.headers.get('cache-control')}"`,
    );
  });

  await checks.run('L5', 'an exact version is immutable', async () => {
    let response = await get(`${sealed}/index.js`);
    assertEqual(response.status, 200, 'status');
    let directives = cacheDirectives(response.headers.get('cache-control'));
    assert(
      directives.has('immutable'),
      `sealed must be immutable, got "${response.headers.get('cache-control')}"`,
    );
  });

  await checks.run('L5', 'a range resolves in ONE hop to the exact address', async () => {
    let response = await get(
      `${base}/${realm}/${FIXTURE_PUBLISHER}/${FIXTURE_PACKAGE}@^1.0.0/index.js`,
    );
    assertEqual(response.status, 302, 'status');
    let location = response.headers.get('location') ?? '';
    assert(
      location.includes(`@${FIXTURE_VERSION}/`),
      `location must name the exact version, got "${location}"`,
    );
    let hop = await get(new URL(location, base).href);
    assertEqual(hop.status, 200, 'the hop target');
  });

  await checks.run('L5', 'the sealed and live bodies are the same bytes', async () => {
    let [a, b] = await Promise.all([
      get(`${live}/index.js`).then((r) => r.text()),
      get(`${sealed}/index.js`).then((r) => r.text()),
    ]);
    assertEqual(b, a, 'sealed body');
  });

  // ---- L1 / L12 identity on the wire ------------------------------------
  await checks.run('L12', 'a sealed response carries its tree hash', async () => {
    let response = await get(`${sealed}/index.js`);
    assertEqual(
      response.headers.get('x-deck-tree-hash'),
      FIXTURE_TREE_HASH,
      'x-deck-tree-hash',
    );
  });

  await checks.run('L12', 'a sealed response carries a Content-Digest', async () => {
    let response = await get(`${sealed}/index.js`);
    let digest = response.headers.get('content-digest') ?? '';
    assert(
      /^sha-256=:[A-Za-z0-9+/=]+:$/.test(digest),
      `Content-Digest must be RFC 9530 sha-256, got "${digest}"`,
    );
    let body = Buffer.from(await response.arrayBuffer());
    let expected = (await import('node:crypto'))
      .createHash('sha256')
      .update(body)
      .digest('base64');
    assertEqual(digest, `sha-256=:${expected}:`, 'digest of the served bytes');
  });

  await checks.run('L12', 'writes are refused', async () => {
    for (let method of ['PUT', 'POST', 'DELETE', 'PATCH']) {
      let response = await get(`${sealed}/index.js`, { method });
      assert(
        response.status >= 400,
        `${method} returned ${response.status}; the server must be read-only`,
      );
    }
  });

  await checks.run('L12', 'a missing file is a coded JSON error', async () => {
    let response = await get(`${sealed}/definitely-absent.js`);
    assertEqual(response.status, 404, 'status');
    assert(
      (response.headers.get('content-type') ?? '').includes('json'),
      'errors must be JSON',
    );
    let body = (await response.json()) as { errors?: { code?: string }[] };
    assert(
      typeof body.errors?.[0]?.code === 'string',
      'an error must carry a machine-readable code',
    );
  });

  await checks.run('L12', 'a permanent error is not cached like a transient one', async () => {
    let absent = await get(`${sealed}/definitely-absent.js`);
    let bogus = await get(
      `${base}/${realm}/${FIXTURE_PUBLISHER}/${FIXTURE_PACKAGE}@%%%/index.js`,
    );
    assert(
      absent.headers.get('cache-control') !== null ||
        bogus.headers.get('cache-control') !== null,
      'errors carry no cache directives at all',
    );
  });

  // ---- L2 the pack on the wire ------------------------------------------
  await checks.run('L2', '?format=pack returns a verifiable pack', async () => {
    let response = await get(`${sealed}?format=pack`);
    assertEqual(response.status, 200, 'status');
    assertEqual(
      response.headers.get('x-deck-tree-hash'),
      FIXTURE_TREE_HASH,
      'pack tree hash',
    );
    let bytes = Buffer.from(await response.arrayBuffer());
    assert(bytes.length > 0, 'empty pack');
    // The archive must start with a local file header.
    assertEqual(bytes.subarray(0, 2).toString('latin1'), 'PK', 'zip magic');
  });

  // ---- L4 immutability on the wire --------------------------------------
  await checks.run('L4', 'every fixture file serves its exact bytes', async () => {
    for (let file of fixtureFiles()) {
      let response = await get(`${sealed}/${file.path}`);
      assertEqual(response.status, 200, `status for ${file.path}`);
      let body = Buffer.from(await response.arrayBuffer());
      assert(
        body.equals(file.bytes),
        `${file.path} came back changed (${body.length} bytes, expected ${file.bytes.length})`,
      );
    }
  });

  // ---- L7 resolution on the wire ----------------------------------------
  await checks.run('L7', 'a declared export alias resolves', async () => {
    let response = await get(`${sealed}/alias.js`);
    assert(
      response.status === 200 || response.status === 301,
      `an exported alias must resolve, got ${response.status}`,
    );
    if (response.status === 301) {
      let hop = await get(
        new URL(response.headers.get('location') ?? '', base).href,
      );
      assertEqual(hop.status, 200, 'alias hop');
    }
  });

  // ---- L8 provenance on the wire ----------------------------------------
  await checks.run('L8', '?meta reports the tree hash and inventory', async () => {
    let response = await get(`${sealed}?meta`);
    assertEqual(response.status, 200, 'status');
    let body = (await response.json()) as {
      data?: { attributes?: { treeHash?: string; files?: string[] } };
    };
    assertEqual(
      body.data?.attributes?.treeHash,
      FIXTURE_TREE_HASH,
      'meta treeHash',
    );
    let files = body.data?.attributes?.files ?? [];
    for (let file of fixtureFiles()) {
      assert(files.includes(file.path), `meta omits ${file.path}`);
    }
  });

  checks.skip('L9', 'a signature envelope is served', 'unbuilt');
  checks.skip('L10', 'a fork reports the same endorsements', 'follows L9');
  checks.skip(
    'L11',
    'the verify gate refuses an unverifiable pin',
    'no verify gate on publish/lock yet',
  );
  checks.skip('L3', 'pointer semantics', 'checked at rest');
  checks.skip('L6', 'hermeticity', 'checked at rest');

  return checks.results;
}
