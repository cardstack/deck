// Signatures, and what they are ABOUT.
//
// A signature binds a key to a treeHash — never to a name (L9). That is why
// an endorsement survives a mirror, a cache, a rename, and a re-publish
// under someone else's publisher: it is a claim about bytes. Two publishers
// holding genuinely identical bytes hold the same endorsements (L10), and
// content addressing has already collapsed them to one stored tree.

import { parseArgs } from 'node:util';
import { readStoreMeta } from '@cardstack/deck/store';
import { createKey, listKeys, resolveKey } from '@cardstack/deck/keyring';
import {
  appendSignature,
  readEnvelope,
  signTreeHash,
  verifyEnvelope,
} from '@cardstack/deck/signature';
import { defineCommand, type Command } from '../command.ts';
import { depotAt, fail } from '../support.ts';

const keygen = defineCommand({
  name: 'keygen',
  group: 'endorse',
  summary: 'create a local ed25519 signing key (or list the ones you have)',
  usage: ['keygen [--label <l>] [--list]'],
  detail: `The private key is written under ~/.deck/keys and never leaves
this machine; the public key travels inside each signature, so verifying
needs nothing but the envelope.

Trust is a separate question this does not answer: a signature verifies, but
whether you trust the key that made it is not modelled yet.`,
  async run(argv) {
    let { values } = parseArgs({
      args: argv,
      options: {
        label: { type: 'string' },
        list: { type: 'boolean', default: false },
      },
    });
    if (values.list) {
      let keys = await listKeys();
      if (keys.length === 0) {
        console.log('no keys yet — run `deck keygen`');
      }
      for (let key of keys) {
        console.log(key.keyId);
      }
      return;
    }
    let key = await createKey({ label: values.label });
    console.log(`created ${key.keyId}`);
    console.log(
      '  the private key never leaves this machine; the public key travels inside each signature',
    );
  },
});

const sign = defineCommand({
  name: 'sign',
  group: 'endorse',
  summary: "endorse a published version's tree hash",
  usage: [
    'sign --depot <dir> --publisher <p> --name <n> --version <v>',
    '     [--key <id>] [--role publish|dev|attest]',
  ],
  detail: `The envelope lives with the tree, not with the version record, so
every deck holding these bytes carries the endorsement — including a fork
that has not diverged.`,
  async run(argv) {
    let { values } = parseArgs({
      args: argv,
      options: {
        depot: { type: 'string' },
        publisher: { type: 'string' },
        name: { type: 'string' },
        version: { type: 'string' },
        key: { type: 'string' },
        role: { type: 'string' },
      },
    });
    if (!values.depot || !values.publisher || !values.name || !values.version) {
      fail(
        'usage: deck sign --depot <dir> --publisher <p> --name <n> --version <v> [--key <id>] [--role publish|dev]',
      );
    }
    let { storeDir } = depotAt(values.depot!);
    let deck = `${values.publisher}/${values.name}`;
    let meta = await readStoreMeta(storeDir, deck);
    let record = meta?.versions[values.version!];
    if (!record) {
      fail(`${deck}@${values.version} is not a published version`);
    }
    let role = (values.role ?? 'publish') as 'publish' | 'dev' | 'attest';
    if (!['publish', 'dev', 'attest'].includes(role)) {
      fail('--role must be publish, dev or attest');
    }
    let key = await resolveKey({ keyId: values.key });
    let envelope = await appendSignature(
      storeDir,
      record!.treeHash,
      signTreeHash({
        treeHash: record!.treeHash,
        key,
        role,
        publisher: values.publisher,
        createdAt: new Date().toISOString(),
      }),
    );
    console.log(
      `signed ${deck}@${values.version} (${record!.treeHash.slice(0, 12)}) as ${key.keyId} [${role}]`,
    );
    console.log(
      `  ${envelope.signatures.length} endorsement(s) on this tree — every deck with these bytes has them`,
    );
  },
});

const verifySig = defineCommand({
  name: 'verify-sig',
  group: 'endorse',
  summary: 'check the endorsements on a tree hash',
  usage: [
    'verify-sig --depot <dir> [--tree-hash <hex>',
    '           | --publisher <p> --name <n> --version <v>] [--require <n>]',
  ],
  detail: `--require <n> fails unless at least n signatures verify, which is
the shape a release gate wants. An invalid signature is always a nonzero
exit, whatever --require says.`,
  async run(argv) {
    let { values } = parseArgs({
      args: argv,
      options: {
        depot: { type: 'string' },
        'tree-hash': { type: 'string' },
        publisher: { type: 'string' },
        name: { type: 'string' },
        version: { type: 'string' },
        require: { type: 'string' },
      },
    });
    if (!values.depot) {
      fail(
        'usage: deck verify-sig --depot <dir> [--tree-hash <hex> | --publisher <p> --name <n> --version <v>] [--require <n>]',
      );
    }
    let { storeDir } = depotAt(values.depot!);
    let treeHash = values['tree-hash'];
    if (!treeHash) {
      if (!values.publisher || !values.name || !values.version) {
        fail('give --tree-hash, or --publisher/--name/--version');
      }
      let meta = await readStoreMeta(
        storeDir,
        `${values.publisher}/${values.name}`,
      );
      treeHash = meta?.versions[values.version!]?.treeHash;
      if (!treeHash) {
        fail(
          `${values.publisher}/${values.name}@${values.version} is not a published version`,
        );
      }
    }
    let envelope = await readEnvelope(storeDir, treeHash!);
    let verdict = envelope
      ? verifyEnvelope(treeHash!, envelope)
      : { valid: [], invalid: [], mismatched: false };
    for (let signature of verdict.valid) {
      console.log(`  ok    ${signature.keyId} [${signature.role}]`);
    }
    for (let signature of verdict.invalid) {
      console.log(`  BAD   ${signature.keyId} [${signature.role}]`);
    }
    console.log(
      `${verdict.valid.length} valid, ${verdict.invalid.length} invalid on ${treeHash!.slice(0, 12)}`,
    );
    let required = values.require ? Number(values.require) : 0;
    if (verdict.valid.length < required) {
      fail(
        `L9: ${verdict.valid.length} valid endorsement(s), ${required} required`,
      );
    }
    if (verdict.invalid.length > 0) {
      process.exitCode = 1;
    }
  },
});

export const ENDORSE_COMMANDS: Command[] = [keygen, sign, verifySig];
