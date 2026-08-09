#!/usr/bin/env node
// W10's second proof: can a pack be verified without holding it in memory?
//
// THE DECISION THIS FEEDS. `bare` mode is meant to replace the realm's
// "Download Zip" button. A realm can be large; the caps in canonical-zip.ts
// are 10,000 entries and 512 MB uncompressed, and they were chosen to be
// safe for an implementation that buffers everything. If identity can only
// be computed over a fully materialised pack, those caps are the product
// limit and `bare` has to coexist with the old button for anything bigger.
// If identity can be computed as the bytes go past, the caps are a policy
// dial instead.
//
// WHY IT MIGHT WORK. tree-hash-v1 is a manifest over (path, sha256) sorted
// in UTF-8 byte order, and canonical-zip-v1 stores entries in exactly that
// order after the packlist. So a canonical pack arrives pre-sorted: hash
// each entry as it streams past, append its manifest line, and the tree hash
// falls out at the end. Nothing needs to be held but the manifest.
//
//   node packages/tools/spikes/streaming-hash.mjs [--mb 256] [--files 2000]
//
// Each phase runs in its own child process so `maxRSS` is that phase's true
// peak rather than a shared high-water mark.

import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInflateRaw } from 'node:zlib';
import { pack, unpack } from '@cardstack/deck/pack';
import { TREE_HASH_SPEC } from '@cardstack/deck/tree-hash';

const self = fileURLToPath(import.meta.url);
const LOCAL_SIG = 0x04034b50;

function args() {
  let out = { mb: 256, files: 2000 };
  for (let i = 2; i < process.argv.length; i += 2) {
    let key = process.argv[i].replace(/^--/, '');
    if (key in out) out[key] = Number(process.argv[i + 1]);
  }
  return out;
}

// Deterministic content that compresses about as well as source code does
// (~3-4x), because the shape of the answer depends on it: highly repetitive
// filler would deflate to nothing and make the streaming case look free by
// giving it almost nothing to inflate, while random bytes would make deflate
// pointless. Identifier-like tokens from a small LCG land in between.
function body(index, size) {
  let out = Buffer.alloc(size);
  let state = (index + 1) * 2654435761 % 2 ** 31;
  let at = 0;
  while (at < size) {
    state = (state * 1103515245 + 12345) % 2 ** 31;
    let token = `const v${state.toString(36)} = ${state % 997};\n`;
    at += out.write(token, at, 'utf8');
  }
  return out;
}

function tree({ mb, files }) {
  let each = Math.floor((mb * 1024 * 1024) / files);
  let out = [];
  for (let i = 0; i < files; i++) {
    out.push({ path: `src/${String(i).padStart(6, '0')}.js`, bytes: body(i, each) });
  }
  return out;
}

// ---------------------------------------------------------------------------
// The streaming verifier.
//
// Reads local headers in order and inflates each entry straight into a hash.
// Never holds more than one chunk plus the manifest.
//
// It works because canonical-zip-v1 writes the uncompressed and compressed
// sizes into the LOCAL header. A general zip may defer both to a data
// descriptor after the entry, or disagree with the central directory at the
// end — which is why the ordinary reader treats the central directory as the
// truth. So this path is for canonical packs, and a foreign zip still has to
// be read the slow way. That is a fair trade: a pack this produces is
// canonical by construction.
// ---------------------------------------------------------------------------
async function streamTreeHash(file) {
  let lines = [];
  let pending = Buffer.alloc(0);
  let state = 'header';
  let entry = null;

  function finish() {
    if (!entry) return;
    lines.push({ path: entry.path, sha256: entry.hash.digest('hex') });
    entry = null;
  }

  for await (let chunk of createReadStream(file, { highWaterMark: 1 << 16 })) {
    let cursor = Buffer.concat([pending, chunk]);
    pending = Buffer.alloc(0);
    let at = 0;
    while (at < cursor.length) {
      if (state === 'header') {
        if (cursor.length - at < 30) break;
        if (cursor.readUInt32LE(at) !== LOCAL_SIG) {
          state = 'done';
          break;
        }
        let nameLength = cursor.readUInt16LE(at + 26);
        let extraLength = cursor.readUInt16LE(at + 28);
        if (cursor.length - at < 30 + nameLength + extraLength) break;
        let method = cursor.readUInt16LE(at + 8);
        let compressed = cursor.readUInt32LE(at + 18);
        let path = cursor
          .subarray(at + 30, at + 30 + nameLength)
          .toString('utf8');
        at += 30 + nameLength + extraLength;
        entry = { path, remaining: compressed, hash: createHash('sha256') };
        if (method === 8) {
          entry.inflate = createInflateRaw();
          entry.inflate.on('data', (part) => entry.hash.update(part));
          entry.done = new Promise((resolve, reject) => {
            entry.inflate.on('end', resolve);
            entry.inflate.on('error', reject);
          });
        }
        state = compressed === 0 ? 'header' : 'data';
        if (state === 'header') {
          if (entry.inflate) {
            entry.inflate.end();
            await entry.done;
          }
          finish();
        }
        continue;
      }
      if (state === 'data') {
        let take = Math.min(entry.remaining, cursor.length - at);
        let slice = cursor.subarray(at, at + take);
        if (entry.inflate) {
          if (!entry.inflate.write(slice)) {
            await new Promise((resolve) => entry.inflate.once('drain', resolve));
          }
        } else {
          entry.hash.update(slice);
        }
        entry.remaining -= take;
        at += take;
        if (entry.remaining === 0) {
          if (entry.inflate) {
            entry.inflate.end();
            await entry.done;
          }
          finish();
          state = 'header';
        }
        continue;
      }
      break; // 'done' — the central directory starts here
    }
    if (state !== 'done' && at < cursor.length) {
      pending = Buffer.from(cursor.subarray(at));
    }
    if (state === 'done') break;
  }

  // The packlist is the first entry and describes the tree rather than being
  // part of it, so it is excluded exactly as `pack()` excludes it.
  let manifest = lines.filter((line) => line.path !== 'packlist.json');

  // The claim being tested: a canonical pack arrives in manifest order, so
  // nothing has to be held back to sort it. Checked rather than assumed —
  // if it were false, a streaming verifier would need every path in memory
  // before it could hash anything, and the whole idea would collapse into
  // "buffer less", which is not the same promise.
  let ordered = manifest.every(
    (line, i) =>
      i === 0 ||
      Buffer.compare(
        Buffer.from(manifest[i - 1].path, 'utf8'),
        Buffer.from(line.path, 'utf8'),
      ) < 0,
  );
  let text = manifest.map((line) => `${line.sha256}  ${line.path}\n`).join('');
  return {
    treeHash: createHash('sha256').update(text).digest('hex'),
    ordered,
    entries: manifest.length,
  };
}

// ---------------------------------------------------------------------------

async function phaseBuild(options, file) {
  let started = Date.now();
  let bytes = pack(tree(options));
  await writeFile(file, bytes);
  return { ms: Date.now() - started, packBytes: bytes.length };
}

async function phaseUnpack(file) {
  let { readFile } = await import('node:fs/promises');
  let started = Date.now();
  let opened = unpack(await readFile(file));
  return { ms: Date.now() - started, treeHash: opened.treeHash };
}

// Everything a phase costs before it does any work: Node itself, plus this
// script's imports. Subtracting it is the difference between "streaming uses
// 166 MB" and "streaming adds almost nothing to a process that was going to
// exist anyway".
async function phaseBaseline() {
  return { ms: 0 };
}

async function phaseStream(file) {
  let started = Date.now();
  let result = await streamTreeHash(file);
  return { ms: Date.now() - started, ...result };
}

// A child that dies is a result, not an error — at a large enough size that
// is the finding.
//
// (`--max-old-space-size` was tried here and does not bite: a pack lives in
// Buffers, which are external to V8's old space, so the flag constrains the
// wrong pool. Locating the ceiling by starving the process would need an
// OS-level limit, and the held-memory numbers below answer the question
// without one.)
function child(phase, options, file, { tolerant = false } = {}) {
  return new Promise((resolve, reject) => {
    let proc = spawn(
      process.execPath,
      // --expose-gc so "held" means retained rather than not-yet-collected.
      ['--expose-gc', self, '--phase', phase, '--file', file, '--mb', options.mb, '--files', options.files],
      { stdio: ['ignore', 'pipe', tolerant ? 'ignore' : 'inherit'] },
    );
    let out = '';
    proc.stdout.on('data', (d) => (out += d));
    proc.on('error', reject);
    proc.on('exit', (code) => {
      if (code === 0) return resolve(JSON.parse(out));
      if (tolerant) return resolve({ failed: true, code });
      reject(new Error(`${phase} exited ${code}`));
    });
  });
}

let phase = process.argv.includes('--phase')
  ? process.argv[process.argv.indexOf('--phase') + 1]
  : undefined;

if (phase) {
  let file = process.argv[process.argv.indexOf('--file') + 1];
  let options = args();
  let result =
    phase === 'build'
      ? await phaseBuild(options, file)
      : phase === 'unpack'
        ? await phaseUnpack(file)
        : phase === 'baseline'
          ? await phaseBaseline()
          : await phaseStream(file);
  // Two numbers, because they answer different questions. maxRSS is a
  // high-water mark that never comes back down, so it counts transient
  // buffers the allocator has not returned to the OS. What decides whether
  // a size is reachable is what is still HELD when the work is done.
  let peakMb = process.resourceUsage().maxRSS / 1024; // Node reports kilobytes
  globalThis.gc?.(); // without this, "held" counts garbage that simply has not been collected
  let usage = process.memoryUsage();
  let heldMb = (usage.heapUsed + usage.external) / 1024 ** 2;
  process.stdout.write(JSON.stringify({ ...result, peakMb, heldMb }));
} else {
  let options = args();
  let dir = await mkdtemp(join(tmpdir(), 'deck-spike-'));
  let file = join(dir, 'spike.pack.zip');
  try {
    console.log(
      `\n  streaming-hash spike — ${options.files} files, ${options.mb} MB logical\n`,
    );
    let built = await child('build', options, file);
    let onDisk = (await stat(file)).size;
    console.log(
      `  pack()          ${String(built.ms).padStart(6)} ms   peak ${built.peakMb.toFixed(0).padStart(5)} MB   → ${(onDisk / 1024 ** 2).toFixed(0)} MB on disk`,
    );
    let opened = await child('unpack', options, file, { tolerant: true });
    console.log(
      opened.failed
        ? `  unpack()          FAILED (exit ${opened.code})`
        : `  unpack()        ${String(opened.ms).padStart(6)} ms   peak ${opened.peakMb.toFixed(0).padStart(5)} MB   held ${opened.heldMb.toFixed(0).padStart(5)} MB`,
    );
    let streamed = await child('stream', options, file, { tolerant: true });
    console.log(
      streamed.failed
        ? `  streamed          FAILED (exit ${streamed.code})`
        : `  streamed        ${String(streamed.ms).padStart(6)} ms   peak ${streamed.peakMb.toFixed(0).padStart(5)} MB   held ${streamed.heldMb.toFixed(0).padStart(5)} MB`,
    );
    let floor = await child('baseline', options, file);
    console.log(
      `  (baseline                    peak ${floor.peakMb.toFixed(0).padStart(5)} MB   held ${floor.heldMb.toFixed(0).padStart(5)} MB — node + this script's imports)`,
    );
    if (opened.failed || streamed.failed) {
      console.log(
        `\n  the ceiling is the buffered path, not the identity: ${streamed.failed ? 'both' : 'unpack()'} could not finish\n`,
      );
    } else {
      console.log(
        `\n  tree hash agrees:  ${opened.treeHash === streamed.treeHash ? 'YES' : `NO — ${opened.treeHash} vs ${streamed.treeHash}`}`,
      );
      console.log(
        `  arrived sorted:    ${streamed.ordered ? 'YES — no buffering needed to reach manifest order' : 'NO'}  (${streamed.entries} entries)`,
      );
      console.log(
        `  held over baseline: unpack +${(opened.heldMb - floor.heldMb).toFixed(0)} MB · streamed +${(streamed.heldMb - floor.heldMb).toFixed(0)} MB   (logical tree ${options.mb} MB)\n`,
      );
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
