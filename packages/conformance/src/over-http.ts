import {
  FIXTURE_PACKAGE,
  FIXTURE_PUBLISHER,
  FIXTURE_TREE_HASH,
  FIXTURE_VERSION,
  fixtureFiles,
  GRAPH_APP,
  GRAPH_LEAF,
  GRAPH_MODULES,
  GRAPH_PUBLISHER,
  GRAPH_VERSION,
  graphModuleUrl,
} from './fixture.ts';
import { assert, assertEqual, Checks, type CheckResult } from './laws.ts';

// Over-the-wire conformance: BLACK BOX. Nothing here imports @deck/core, so
// the same run measures the reference server and the Boxel realm server with
// no changes and no shared code to be wrong in the same way.
//
// The target must be serving the canonical fixture depot, live at
// /<depot>/deck/fixture/ and sealed at /<depot>/deck/fixture@1.0.0/.

export interface HttpTarget {
  // e.g. "http://localhost:8788"
  baseUrl: string;
  // e.g. "conformance"
  depot: string;
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
  let { baseUrl, depot, fetchImpl = fetch } = target;
  let base = baseUrl.replace(/\/$/, '');
  let live = `${base}/${depot}/${FIXTURE_PUBLISHER}/${FIXTURE_PACKAGE}`;
  let sealed = `${base}/${depot}/${FIXTURE_PUBLISHER}/${FIXTURE_PACKAGE}@${FIXTURE_VERSION}`;
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
      `${base}/${depot}/${FIXTURE_PUBLISHER}/${FIXTURE_PACKAGE}@^1.0.0/index.js`,
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

  await checks.run('L12', 'a sealed response digests its representation', async () => {
    let response = await get(`${sealed}/index.js`);
    // Repr-Digest is the stable one: the module bytes, encoding aside. It is
    // what a client can verify after decoding, and the only one that stays
    // put when an edge re-compresses.
    let digest = response.headers.get('repr-digest') ?? '';
    assert(
      /^sha-256=:[A-Za-z0-9+/=]+:$/.test(digest),
      `Repr-Digest must be RFC 9530 sha-256, got "${digest}"`,
    );
    let body = Buffer.from(await response.arrayBuffer());
    let expected = (await import('node:crypto'))
      .createHash('sha256')
      .update(body)
      .digest('base64');
    assertEqual(digest, `sha-256=:${expected}:`, 'digest of the decoded bytes');
  });

  // Amendment A1/A6. Without Vary a shared cache hands a compressed body to
  // a client that asked for none; without the two-digest split, an edge that
  // re-encodes makes the digest look like corruption.
  await checks.run('L12', 'compression is negotiated, varied, and digested twice', async () => {
    let raw = await fetchImpl(`${sealed}/bulky.js`, {
      redirect: 'manual',
      headers: { 'accept-encoding': 'identity' },
    });
    assertEqual(raw.status, 200, 'identity status');
    assert(
      (raw.headers.get('vary') ?? '').toLowerCase().includes('accept-encoding'),
      'a negotiated response must Vary: Accept-Encoding',
    );
    assertEqual(
      raw.headers.get('content-encoding'),
      null,
      'identity must not be encoded',
    );
    assertEqual(
      raw.headers.get('content-digest'),
      raw.headers.get('repr-digest'),
      'with no coding applied the two digests are the same claim',
    );

    let zipped = await fetchImpl(`${sealed}/bulky.js`, {
      redirect: 'manual',
      headers: { 'accept-encoding': 'gzip' },
    });
    assertEqual(
      zipped.headers.get('content-encoding'),
      'gzip',
      'gzip must be offered at origin',
    );
    assertEqual(
      zipped.headers.get('repr-digest'),
      raw.headers.get('repr-digest'),
      'Repr-Digest is stable across encodings — that is its whole job',
    );
    assert(
      zipped.headers.get('content-digest') !== zipped.headers.get('repr-digest'),
      'Content-Digest must describe the ENCODED bytes, not the module',
    );
    // fetch decodes for us, so this also proves the body survived the trip.
    let decoded = Buffer.from(await zipped.arrayBuffer());
    let expected = (await import('node:crypto'))
      .createHash('sha256')
      .update(decoded)
      .digest('base64');
    assertEqual(
      zipped.headers.get('repr-digest'),
      `sha-256=:${expected}:`,
      'Repr-Digest verifies after decoding',
    );
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
      `${base}/${depot}/${FIXTURE_PUBLISHER}/${FIXTURE_PACKAGE}@%%%/index.js`,
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

  // L9/L10 over the wire. The fixture is unsigned by default, so these
  // check the SHAPE of the answer: a tree with no endorsements says so
  // clearly, and ?meta always carries the (possibly empty) summary.
  await checks.run('L9', '?meta reports an endorsement summary', async () => {
    let response = await get(`${sealed}?meta`);
    let body = (await response.json()) as {
      data?: { attributes?: { signatures?: unknown } };
    };
    assert(
      Array.isArray(body.data?.attributes?.signatures),
      '?meta must always carry a signatures array, empty when unsigned',
    );
  });

  await checks.run('L9', 'endorsements are addressed by tree hash', async () => {
    let response = await get(
      `${base}/${depot}/_trees/${FIXTURE_TREE_HASH}/signatures`,
    );
    assert(
      response.status === 200 || response.status === 404,
      `expected an envelope or a clean 404, got ${response.status}`,
    );
    if (response.status === 404) {
      let body = (await response.json()) as { errors?: { code?: string }[] };
      assertEqual(body.errors?.[0]?.code, 'no-signatures', 'error code');
      return;
    }
    let envelope = (await response.json()) as {
      spec?: string;
      treeHash?: { hash?: string };
    };
    assertEqual(envelope.spec, 'deck-sig-v1', 'envelope spec');
    assertEqual(envelope.treeHash?.hash, FIXTURE_TREE_HASH, 'envelope subject');
  });

  await checks.run('L10', 'a nonsense tree hash is refused, not invented', async () => {
    let response = await get(
      `${base}/${depot}/_trees/${'0'.repeat(64)}/signatures`,
    );
    assertEqual(response.status, 404, 'unknown tree');
  });
  // ---- L12 the preload closure -------------------------------------------
  //
  // A black-box check, and it has to be one: resolving with the global map
  // alone still finds app and dep, so a scope-blind walk looks like it is
  // working. Only the module sitting behind the scope tells the two apart,
  // and only the wire can show whether the server found it.

  await checks.run(
    'L12',
    'the advertised closure crosses a scoped edge',
    async () => {
      let page = `${base}/${depot}/${GRAPH_PUBLISHER}/${GRAPH_APP}@${GRAPH_VERSION}/page.html`;
      let response = await get(page);
      assertEqual(response.status, 200, 'status');
      let advertised = response.headers.get('x-deck-preload');
      if (advertised === null) {
        // Preloading is an optimisation, not an obligation. Declining
        // entirely is conformant; claiming a closure that is short is not.
        return;
      }
      let [sent, total] = advertised.split('/').map(Number);
      assert(
        total >= GRAPH_MODULES,
        `the graph has ${GRAPH_MODULES} modules and one of them is reachable ` +
          `only through a scope, but the response counted ${total}. A walk ` +
          `that ignores scopes reports the smaller denominator too, so it ` +
          `reads as complete.`,
      );
      let html = await response.text();
      let leaf = graphModuleUrl(depot, GRAPH_LEAF, 'index.js');
      if (sent >= total) {
        assert(
          html.includes(leaf),
          `nothing was clipped, so every module belongs in the document, but ${leaf} is absent`,
        );
      }
      for (let match of html.matchAll(
        /<link[^>]*rel=["']modulepreload["'][^>]*>/gi,
      )) {
        assert(
          /\scrossorigin(\s|=|>)/i.test(match[0]),
          `a modulepreload without crossorigin is fetched twice: ${match[0]}`,
        );
      }
    },
  );

  checks.skip('L11', 'the verify gate', 'checked at rest');
  checks.skip('L3', 'pointer semantics', 'checked at rest');
  checks.skip('L6', 'hermeticity', 'checked at rest');

  return checks.results;
}
