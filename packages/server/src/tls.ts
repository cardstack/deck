// Local HTTPS materials for the reference server.
//
// Browsers will not speak HTTP/2 to a cleartext origin, so the demos that
// load hundreds of modules need a leaf cert. Production still terminates
// TLS (and adds brotli / HTTP/3) at the edge; this path is for
// `localhost` without Cloudflare in front.
//
// Cert generation uses openssl once and caches under `.deck/certs/` (or
// `$DECK_TLS_DIR`). The same leaf covers every demo port — browsers key
// trust by name, not port — so accepting the warning once is enough.

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { request as httpsRequest, type RequestOptions } from 'node:https';
import { join } from 'node:path';
import type { IncomingMessage } from 'node:http';

export type TlsMaterials = {
  cert: Buffer;
  key: Buffer;
};

export type TlsOption = boolean | TlsMaterials;

const OPENSSL_CNF = `[req]
distinguished_name = req_distinguished_name
x509_extensions = v3_req
prompt = no

[req_distinguished_name]
CN = localhost

[v3_req]
subjectAltName = @alt_names
basicConstraints = CA:FALSE
keyUsage = digitalSignature, keyEncipherment
extendedKeyUsage = serverAuth

[alt_names]
DNS.1 = localhost
IP.1 = 127.0.0.1
`;

export function ensureDevTlsMaterials(dir: string): TlsMaterials {
  mkdirSync(dir, { recursive: true });
  let certPath = join(dir, 'cert.pem');
  let keyPath = join(dir, 'key.pem');
  if (existsSync(certPath) && existsSync(keyPath)) {
    return { cert: readFileSync(certPath), key: readFileSync(keyPath) };
  }
  let cfgPath = join(dir, 'openssl.cnf');
  writeFileSync(cfgPath, OPENSSL_CNF);
  try {
    execFileSync(
      'openssl',
      [
        'req',
        '-x509',
        '-newkey',
        'rsa:2048',
        '-nodes',
        '-keyout',
        keyPath,
        '-out',
        certPath,
        '-days',
        '3650',
        '-config',
        cfgPath,
        '-extensions',
        'v3_req',
      ],
      { stdio: 'pipe' },
    );
  } catch (error) {
    throw new Error(
      `deck TLS: openssl failed to mint a localhost leaf in ${dir}: ${
        (error as Error).message
      }`,
      { cause: error },
    );
  }
  return { cert: readFileSync(certPath), key: readFileSync(keyPath) };
}

export function resolveTlsMaterials(
  tls: TlsOption | undefined,
): TlsMaterials | undefined {
  if (tls === undefined || tls === false) {
    return undefined;
  }
  if (tls !== true) {
    return {
      cert: Buffer.isBuffer(tls.cert) ? tls.cert : Buffer.from(tls.cert),
      key: Buffer.isBuffer(tls.key) ? tls.key : Buffer.from(tls.key),
    };
  }
  let certFile = process.env.DECK_TLS_CERT_FILE;
  let keyFile = process.env.DECK_TLS_KEY_FILE;
  if (certFile && keyFile) {
    return { cert: readFileSync(certFile), key: readFileSync(keyFile) };
  }
  let dir = process.env.DECK_TLS_DIR ?? join(process.cwd(), '.deck', 'certs');
  return ensureDevTlsMaterials(dir);
}

function collect(res: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    let chunks: Buffer[] = [];
    res.on('data', (chunk: Buffer) => chunks.push(chunk));
    res.on('end', () => resolve(Buffer.concat(chunks)));
    res.on('error', reject);
  });
}

// Node's built-in fetch rejects the self-signed demo leaf. Use this only for
// loopback probes against a deck server we just started — never for npm /
// the public internet. Does not touch NODE_TLS_REJECT_UNAUTHORIZED.
export async function localFetch(
  input: string | URL,
  init: { method?: string; redirect?: RequestRedirect } = {},
): Promise<Response> {
  let url = typeof input === 'string' ? new URL(input) : input;
  if (url.protocol !== 'https:') {
    return fetch(url, init);
  }
  let options: RequestOptions = {
    protocol: url.protocol,
    hostname: url.hostname,
    port: url.port || 443,
    path: `${url.pathname}${url.search}`,
    method: init.method ?? 'GET',
    rejectUnauthorized: false,
  };
  let res = await new Promise<IncomingMessage>((resolve, reject) => {
    let req = httpsRequest(options, resolve);
    req.on('error', reject);
    req.end();
  });
  let body = await collect(res);
  let status = res.statusCode ?? 0;
  let headers = new Headers();
  for (let [key, value] of Object.entries(res.headers)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      for (let item of value) headers.append(key, item);
    } else {
      headers.set(key, value);
    }
  }
  // Match fetch()'s default redirect: follow. Manual lets the hub treat a
  // 302 from `/` as "the server is up".
  if (
    init.redirect !== 'manual' &&
    status >= 300 &&
    status < 400 &&
    headers.get('location')
  ) {
    return localFetch(new URL(headers.get('location')!, url), {
      ...init,
      redirect: init.redirect,
    });
  }
  return new Response(new Uint8Array(body), { status, headers });
}
