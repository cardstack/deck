#!/usr/bin/env node
// HTTP/1.1 vs HTTP/2, measured on the load this protocol actually creates.
//
// Per-file delivery is the whole point of vendoring at the module boundary,
// and its whole cost is request count: three.js from `src/` is 374 modules
// where the bundle is one. On HTTP/1.1 a browser opens about six connections
// per origin and everything else queues behind them. On HTTP/2 one connection
// carries all of it, multiplexed, with header compression on top.
//
// That is the claim. This measures it, against the real store the demo built,
// with the same bytes on both sides.
//
// The client models what a browser does rather than what a benchmark could
// do if it cheated:
//
//   HTTP/1.1  keep-alive, six sockets, which is Chrome's per-origin limit.
//   HTTP/2    one session, all streams in flight.
//
// Neither number is a WAN measurement. Both servers are on loopback, so the
// per-request cost here is nearly pure protocol overhead with no latency to
// multiply it — which UNDERSTATES the gap, because RTT is exactly what
// HTTP/1.1's six-at-a-time queue turns into wall-clock time. Take the ratio,
// not the milliseconds.
//
//   node examples/three-js/bench.mjs
import { Agent, request as httpRequest } from 'node:http';
import { connect } from 'node:http2';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { unpack } from '@cardstack/deck/pack';
import { readStoredPack, readStoreMeta } from '@cardstack/deck/store';
import { storeDirFor } from '@cardstack/deck-server/depot';
import { createDeckServer } from '@cardstack/deck-server/server';

const here = dirname(fileURLToPath(import.meta.url));
const depotDir = join(here, 'depot');
const storeDir = storeDirFor(depotDir);
const DEPOT = 'site';
const DECK = 'lib/three';
const RUNS = 5;
// Chrome's per-origin connection limit, and the reason a 374-module page is
// slow on HTTP/1.1 no matter how fast the server is.
const H1_SOCKETS = 6;

let meta = await readStoreMeta(storeDir, DECK);
let version = meta?.tags?.latest;
if (!version) {
  console.error(
    'nothing to measure: run `pnpm --filter @cardstack/deck-example-three-js demo` once first,\n' +
      'so the store has a vendored three.js to serve.',
  );
  process.exit(1);
}
let files = [...unpack((await readStoredPack(storeDir, DECK, version)).valueOf()).files.keys()]
  .filter((path) => path.endsWith('.js'))
  .sort();
const PATHS = files.map((path) => `/${DEPOT}/${DECK}@${version}/${path}`);

const depot = { name: DEPOT, dir: depotDir, storeDir };

function listen(server) {
  return new Promise((resolve) => server.listen(0, () => resolve(server.address().port)));
}

// ---------------------------------------------------------------------------
// HTTP/1.1: keep-alive, six sockets, a queue.
// ---------------------------------------------------------------------------
async function fetchAllH1(port) {
  let agent = new Agent({ keepAlive: true, maxSockets: H1_SOCKETS });
  let bytes = 0;
  await Promise.all(
    PATHS.map(
      (path) =>
        new Promise((resolve, reject) => {
          httpRequest({ port, path, agent }, (response) => {
            response.on('data', (chunk) => (bytes += chunk.length));
            response.on('end', resolve);
          })
            .on('error', reject)
            .end();
        }),
    ),
  );
  agent.destroy();
  return bytes;
}

// ---------------------------------------------------------------------------
// HTTP/2: one session, every stream in flight at once.
// ---------------------------------------------------------------------------
async function fetchAllH2(port) {
  let session = connect(`https://localhost:${port}`, { rejectUnauthorized: false });
  // Node's client defaults to 100 concurrent streams; the server's SETTINGS
  // may allow more. Raising it here would measure a browser nobody has.
  await new Promise((resolve, reject) => {
    session.once('connect', resolve);
    session.once('error', reject);
  });
  let bytes = 0;
  await Promise.all(
    PATHS.map(
      (path) =>
        new Promise((resolve, reject) => {
          let stream = session.request({ ':path': path });
          stream.on('data', (chunk) => (bytes += chunk.length));
          stream.on('end', resolve);
          stream.on('error', reject);
          stream.end();
        }),
    ),
  );
  session.close();
  return bytes;
}

async function measure(label, port, run) {
  await run(port); // warm: the first pass pays for cert handshake and page cache
  let samples = [];
  let bytes = 0;
  for (let i = 0; i < RUNS; i++) {
    let started = performance.now();
    bytes = await run(port);
    samples.push(performance.now() - started);
  }
  samples.sort((a, b) => a - b);
  return {
    label,
    median: samples[Math.floor(samples.length / 2)],
    best: samples[0],
    worst: samples.at(-1),
    bytes,
  };
}

let h1 = createDeckServer({ depots: [depot] });
let h2 = createDeckServer({ depots: [depot], tls: true });
let h1Port = await listen(h1);
let h2Port = await listen(h2);

console.log(`\n  HTTP/1.1 vs HTTP/2 — ${PATHS.length} modules, ${RUNS} runs each\n`);
console.log(`  ${DECK}@${version}, served from the same store by both servers.`);
console.log(`  HTTP/1.1 gets ${H1_SOCKETS} keep-alive sockets (Chrome's per-origin limit).`);
console.log(`  HTTP/2 gets one multiplexed session.\n`);

let one = await measure('HTTP/1.1', h1Port, fetchAllH1);
let two = await measure('HTTP/2  ', h2Port, fetchAllH2);

const ms = (n) => `${n.toFixed(0)} ms`.padStart(8);
console.log(`  protocol    median      best     worst    per request`);
for (let result of [one, two]) {
  console.log(
    `  ${result.label}${ms(result.median)}${ms(result.best)}${ms(result.worst)}   ${(result.median / PATHS.length).toFixed(2)} ms`,
  );
}
console.log(
  `\n  ${(one.median / two.median).toFixed(2)}× — HTTP/2 delivers the same ${(two.bytes / 1024).toFixed(0)} KB in ${(100 - (two.median / one.median) * 100).toFixed(0)}% less time.`,
);
// The measurement above is loopback, where RTT is ~0 and the ratio is
// therefore nearly the smallest it will ever be. What actually separates the
// two protocols is the QUEUE: HTTP/1.1 can have six requests in flight, so it
// pays ceil(N/6) round trips; HTTP/2 has them all in flight and pays one.
//
// That is arithmetic on the measured service time, not a second measurement,
// and it is labelled as such. Faking latency convincingly needs a shaped
// link, and a fabricated number dressed as a measurement is worse than an
// honest projection.
const WAVES = Math.ceil(PATHS.length / H1_SOCKETS);
console.log(`
  Projected wall clock at real latency — MODELLED, not measured:
  HTTP/1.1 pays ${WAVES} round trips (${PATHS.length} requests, ${H1_SOCKETS} at a time); HTTP/2 pays one.

    RTT     HTTP/1.1    HTTP/2    ratio`);
for (let rtt of [0, 10, 30, 80]) {
  let a = one.median + WAVES * rtt;
  let b = two.median + rtt;
  console.log(
    `   ${String(rtt).padStart(3)} ms  ${`${a.toFixed(0)} ms`.padStart(9)} ${`${b.toFixed(0)} ms`.padStart(9)}    ${(a / b).toFixed(1)}×`,
  );
}
console.log(`
  Which is why per-file delivery stopped being a trade-off. The bundle
  existed to dodge request count; request count is what HTTP/2 fixed. What
  is left of the cost — bytes on the wire — is what minification, gzip at
  the origin and the modulepreload closure address, and those are already
  built (docs/deck-efficient-delivery-spec.md).
`);

h1.close();
h2.close();
