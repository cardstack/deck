import { gzipSync } from 'node:zlib';

// Workstream B — wire compression.
//
// Store bytes are logical file bytes; `Content-Encoding` is hop packaging.
// Neither enters `tree-hash-v1`, so this layer cannot change what a deck IS.
//
// The digest rule is the part that is easy to get wrong, and the spec's
// first draft did (amendment A1). RFC 9530 defines two headers and they are
// different claims:
//
//   Repr-Digest     the REPRESENTATION — the module bytes, encoding aside.
//                   Stable. What a client verifies after decoding, and what
//                   conformance checks.
//   Content-Digest  the CONTENT AS SENT — after any content coding. A
//                   brotli response digests the brotli bytes.
//
// Emitting a digest of the module bytes under the name `Content-Digest`
// would break any edge that re-compresses or decompresses: the mismatch
// arrives looking like corruption. So both are emitted, and they are equal
// exactly when no coding was applied.

// GZIP ONLY, deliberately.
//
// Cloudflare terminates HTTP/2 and HTTP/3 in front of this server and does
// brotli at the edge, where it is cached and paid for once. Compressing to
// brotli here would burn origin CPU on every cache miss to produce bytes the
// edge is going to re-encode anyway. Origin does the cheap, universal thing;
// the edge does the good thing.
//
// This is also why there is no precompressed-sibling store: the edge cache
// IS that store, and it is closer to the client.
export type Encoding = 'gzip';

// Below this, framing costs more than the compression saves.
export const MIN_COMPRESS_BYTES = 1024;

const COMPRESSIBLE = [
  'text/',
  'application/javascript',
  'application/json',
  'application/xml',
  'image/svg+xml',
];

export function isCompressibleType(contentType: string | undefined): boolean {
  if (!contentType) {
    return false;
  }
  let type = contentType.split(';')[0].trim().toLowerCase();
  return COMPRESSIBLE.some((prefix) => type.startsWith(prefix));
}

// `gzip;q=0.8, *;q=0.1` — a q of 0 is a REFUSAL, not a low preference,
// which is the detail naive parsers miss.
export function negotiateEncoding(
  acceptEncoding: string | undefined,
): Encoding | undefined {
  if (!acceptEncoding) {
    return undefined;
  }
  let weights = new Map<string, number>();
  for (let part of acceptEncoding.split(',')) {
    let [name, ...params] = part.trim().split(';');
    if (!name) {
      continue;
    }
    let q = 1;
    for (let param of params) {
      let match = /^\s*q=([0-9.]+)\s*$/i.exec(param);
      if (match) {
        q = Number(match[1]);
      }
    }
    weights.set(name.trim().toLowerCase(), q);
  }
  let star = weights.get('*');
  let q = weights.get('gzip') ?? star ?? 0;
  return q > 0 ? 'gzip' : undefined;
}

// Level 6 is zlib's default and the right trade for an origin: most of the
// ratio at a fraction of level 9's cost, on a path the edge will usually
// spare us anyway.
export function encodeBody(bytes: Buffer, encoding: Encoding): Buffer {
  void encoding;
  return gzipSync(bytes, { level: 6 });
}

export interface NegotiatedBody {
  body: Buffer;
  encoding?: Encoding;
  // Set whenever negotiation was even considered, so a shared cache never
  // hands a brotli body to a gzip-only client. Its absence is the classic
  // compression-behind-a-CDN failure.
  vary: boolean;
}

export function negotiateBody(options: {
  body: Buffer;
  contentType: string | undefined;
  acceptEncoding: string | undefined;
  // Already encoded upstream, or a format that is its own container.
  alreadyEncoded?: boolean;
  // Kept as a seam: if an origin ever wants to serve stored encodings, the
  // negotiation already knows how. Nothing populates it today, because the
  // edge cache does this job better.
  precompressed?: Partial<Record<Encoding, Buffer>>;
}): NegotiatedBody {
  let { body, contentType, acceptEncoding, alreadyEncoded } = options;
  if (alreadyEncoded || !isCompressibleType(contentType)) {
    return { body, vary: false };
  }
  let encoding = negotiateEncoding(acceptEncoding);
  if (!encoding) {
    // Still Vary: the answer depended on the header even though nothing
    // was applied this time.
    return { body, vary: true };
  }
  let stored = options.precompressed?.[encoding];
  if (stored) {
    return { body: stored, encoding, vary: true };
  }
  if (body.length < MIN_COMPRESS_BYTES) {
    return { body, vary: true };
  }
  let encoded = encodeBody(body, encoding);
  // A compressor that made it bigger has nothing to offer.
  return encoded.length < body.length
    ? { body: encoded, encoding, vary: true }
    : { body, vary: true };
}
