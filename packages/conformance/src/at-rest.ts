import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { hashBytes, treeHashFromDir, treeHashFromEntries } from '@cardstack/deck/tree-hash';
import { pack, packFromDir, unpack } from '@cardstack/deck/pack';
import {
  publishToStore,
  readStoredFile,
  readStoredPack,
  readStoreMeta,
  releaseVersion,
  resolveVersionSpec,
} from '@cardstack/deck/store';
import { walkSourceGraph } from '@cardstack/deck/vendor-npm';
import {
  appendSignature,
  generateKeyPair,
  readEnvelope,
  signingPayload,
  summarizeEnvelope,
  signTreeHash,
  verifyEnvelope,
  verifySignature,
} from '@cardstack/deck/signature';
import { parseDependencyValue } from '@cardstack/deck/lock';
import { flattenInheritance, isExactParent } from '@cardstack/deck/inherit';
import { classifyReference } from '@cardstack/deck/classify';
import {
  moduleSpecifiers,
  unanalyzableDynamicImports,
} from '@cardstack/deck/es-lexer';
import {
  createPacklist,
  parsePacklist,
  serializePacklist,
} from '@cardstack/deck/packlist';
import { resolveSpecifier } from '@cardstack/deck/resolve';
import { verifyLinks } from '@cardstack/deck/verify-links';
import {
  deriveMinified,
  derivedPack,
  terserVersion,
  verifyDerivation,
} from '@cardstack/deck/derive';
import {
  FIXTURE_PACKAGE,
  FIXTURE_PUBLISHER,
  FIXTURE_TREE_HASH,
  FIXTURE_VERSION,
  fixtureFiles,
  writeFixtureDepot,
} from './fixture.ts';
import { assert, assertEqual, Checks, type CheckResult } from './laws.ts';

// At-rest conformance: the laws that are about bytes and state, checkable
// without a server. These call @cardstack/deck directly today; an implementation
// in another language runs the equivalent through its own entry points and
// must reach the same answers — the FIXTURE_TREE_HASH is what makes that
// comparison meaningful rather than self-referential.

export async function runAtRestChecks(): Promise<CheckResult[]> {
  let checks = new Checks();
  let root = await mkdtemp(join(tmpdir(), 'deck-conform-'));
  let storeDir = join(root, 'store');
  let name = `${FIXTURE_PUBLISHER}/${FIXTURE_PACKAGE}`;

  try {
    // ---- L1 identity -----------------------------------------------------
    await checks.run('L1', 'the fixture tree hashes to the golden value', () => {
      let entries = fixtureFiles().map((file) => ({
        path: file.path,
        sha256: hashBytes(file.bytes),
      }));
      assertEqual(
        treeHashFromEntries(entries).treeHash,
        FIXTURE_TREE_HASH,
        'fixture treeHash',
      );
    });

    await checks.run('L1', 'hashing a directory agrees with hashing entries', async () => {
      let depotDir = await writeFixtureDepot(root);
      let fromDir = await treeHashFromDir(
        join(depotDir, FIXTURE_PUBLISHER, FIXTURE_PACKAGE),
      );
      assertEqual(fromDir.treeHash, FIXTURE_TREE_HASH, 'directory treeHash');
    });

    await checks.run('L1', 'entry order does not change the hash', () => {
      let files = fixtureFiles();
      let forward = treeHashFromEntries(
        files.map((f) => ({ path: f.path, sha256: hashBytes(f.bytes) })),
      ).treeHash;
      let reversed = treeHashFromEntries(
        [...files]
          .reverse()
          .map((f) => ({ path: f.path, sha256: hashBytes(f.bytes) })),
      ).treeHash;
      assertEqual(reversed, forward, 'reversed input');
    });

    await checks.run('L1', 'depot bookkeeping is invisible to the hash', async () => {
      let depotDir = await writeFixtureDepot(root);
      let deckDir = join(depotDir, FIXTURE_PUBLISHER, FIXTURE_PACKAGE);
      let before = (await treeHashFromDir(deckDir)).treeHash;
      await writeFile(join(deckDir, '.DS_Store'), 'junk');
      assertEqual(
        (await treeHashFromDir(deckDir)).treeHash,
        before,
        'hash after adding an ignored file',
      );
    });

    // The fixture contains a non-ASCII filename on purpose, and the golden
    // root above is only meaningful if every implementation agrees on how it
    // is spelled. Paths are hashed as UTF-8 bytes, so NFC and NFD are
    // different trees; without this check the golden hash is stable by luck
    // — whichever normalisation the building filesystem happened to use.
    await checks.run('L1', 'tree paths are Unicode NFC', async () => {
      for (let file of fixtureFiles()) {
        assertEqual(
          file.path.normalize('NFC'),
          file.path,
          `fixture path ${JSON.stringify(file.path)} must be NFC`,
        );
      }
      let decomposed = 'ä-utf8.txt';
      assert(
        decomposed.normalize('NFC') !== decomposed,
        'the negative case must actually be non-NFC',
      );
      let refused = false;
      try {
        treeHashFromEntries([{ path: decomposed, sha256: 'ab'.repeat(32) }]);
      } catch {
        refused = true;
      }
      assert(refused, 'a non-NFC tree path must be refused, not normalised away');
    });

    // ---- L2 round trip ---------------------------------------------------
    let sealed = pack(fixtureFiles());

    await checks.run('L2', 'packing is faithful', () => {
      assertEqual(unpack(sealed).treeHash, FIXTURE_TREE_HASH, 'unpacked treeHash');
    });

    await checks.run('L2', 'packs have a canonical form', () => {
      let opened = unpack(sealed);
      let again = pack(
        [...opened.files.entries()].map(([path, bytes]) => ({ path, bytes })),
      );
      assert(again.equals(sealed), 'pack(unpack(P)) is not byte-identical to P');
    });

    await checks.run('L2', 'a tampered pack does not open', () => {
      let tampered = Buffer.from(sealed);
      // Flip a byte in the middle of the payload, past the local header.
      tampered[Math.floor(tampered.length / 2)] ^= 0xff;
      let opened = false;
      try {
        unpack(tampered);
        opened = true;
      } catch {
        // expected
      }
      assert(!opened, 'a tampered pack opened');
    });

    await checks.run('L2', 'packing a directory matches packing its files', async () => {
      let depotDir = await writeFixtureDepot(root);
      let fromDir = await packFromDir(
        join(depotDir, FIXTURE_PUBLISHER, FIXTURE_PACKAGE),
      );
      assertEqual(unpack(fromDir).treeHash, FIXTURE_TREE_HASH, 'dir pack');
    });

    // ---- L3 pointer / L4 immutability ------------------------------------
    await checks.run('L3', 'publishing the same content twice adds no bytes', async () => {
      await publishToStore(storeDir, name, '1.0.0-dev.1', sealed);
      await publishToStore(storeDir, name, '1.0.0-dev.2', sealed);
      let meta = await readStoreMeta(storeDir, name);
      assertEqual(
        meta!.versions['1.0.0-dev.1'].treeHash,
        meta!.versions['1.0.0-dev.2'].treeHash,
        'two versions of identical content',
      );
    });

    await checks.run('L3', 'release names an existing state and copies nothing', async () => {
      await releaseVersion(
        storeDir,
        name,
        FIXTURE_VERSION,
        { version: '1.0.0-dev.2' },
        { tag: 'latest' },
      );
      let meta = await readStoreMeta(storeDir, name);
      assertEqual(
        meta!.versions[FIXTURE_VERSION].treeHash,
        FIXTURE_TREE_HASH,
        'released treeHash',
      );
      assertEqual(meta!.tags.latest, FIXTURE_VERSION, 'latest tag');
    });

    await checks.run('L4', 're-publishing a version is refused', async () => {
      let refused = false;
      try {
        await publishToStore(storeDir, name, FIXTURE_VERSION, sealed);
      } catch {
        refused = true;
      }
      assert(refused, 're-publishing an existing version succeeded');
    });

    await checks.run('L4', 'a stored version reads back byte-identically', async () => {
      let read = await readStoredPack(storeDir, name, FIXTURE_VERSION);
      assert(read !== undefined, 'stored version is missing');
      assert(read!.equals(sealed), 'stored pack differs from what was published');
    });

    await checks.run('L4', 'one file reads back byte-identically', async () => {
      let expected = fixtureFiles().find((f) => f.path === 'crlf.txt')!.bytes;
      let read = await readStoredFile(storeDir, name, FIXTURE_VERSION, 'crlf.txt');
      assert(read !== undefined && read.equals(expected), 'CRLF file changed');
    });

    // ---- L5 volatility (the resolution half; serving is over HTTP) -------
    await checks.run('L5', 'a range never matches a prerelease', async () => {
      let meta = await readStoreMeta(storeDir, name);
      let resolved = resolveVersionSpec('^1.0.0', meta!);
      assert(resolved.kind !== 'not-found', 'range resolved to nothing');
      let version =
        'version' in resolved ? resolved.version : '(none)';
      assertEqual(version, FIXTURE_VERSION, '^1.0.0');
    });

    await checks.run('L5', 'an unknown spec is invalid, not merely missing', async () => {
      let meta = await readStoreMeta(storeDir, name);
      assertEqual(
        resolveVersionSpec('%%%', meta!).kind,
        'invalid',
        'nonsense spec',
      );
      assertEqual(
        resolveVersionSpec('9.9.9', meta!).kind,
        'not-found',
        'absent version',
      );
    });

    // ---- L6 hermeticity --------------------------------------------------
    await checks.run('L6', 'a sealed deck resolves everything it contains', () => {
      let files = new Map(fixtureFiles().map((f) => [f.path, f.bytes]));
      let graph = walkSourceGraph(files, 'index.js');
      assertEqual(graph.unresolved.length, 0, 'unresolved relative imports');
      assertEqual(graph.externals.length, 0, 'undeclared external specifiers');
    });

    await checks.run('L6', 'a dangling relative import is detected', () => {
      let files = new Map<string, Buffer>([
        ['index.js', Buffer.from("import './gone.js';\n")],
      ]);
      assert(
        walkSourceGraph(files, 'index.js').unresolved.length > 0,
        'a dangling import was not reported',
      );
    });

    // ---- L7 resolution ---------------------------------------------------
    await checks.run('L7', 'a bare value is a range; a deck value is an alias', () => {
      assertEqual(parseDependencyValue('^1.0.0').target, undefined, 'range');
      assertEqual(parseDependencyValue('^1.0.0').spec, '^1.0.0', 'range spec');
      assertEqual(
        parseDependencyValue('lib/three@0.160.0').target,
        'lib/three',
        'alias target',
      );
      assertEqual(
        parseDependencyValue('lib/three@0.160.0').spec,
        '0.160.0',
        'alias spec',
      );
      assertEqual(
        parseDependencyValue('lib/three').spec,
        'live',
        'a bare deck name means live',
      );
    });

    // ---- L7 inheritance (`extends`) ---------------------------------------
    //
    // Two implementations must agree on these four answers or a remix
    // published against one server resolves differently on another — and an
    // inherited decklist that is not portable is not a decklist.
    await checks.run('L7', 'a child inherits what it does not mention', () => {
      let flat = flattenInheritance([
        { imports: { a: '/p/a.js', b: '/p/b.js' } },
        { imports: { b: '/c/b.js' } },
      ]);
      assertEqual(flat.imports.a, '/p/a.js', 'inherited');
      assertEqual(flat.imports.b, '/c/b.js', 'overridden');
    });

    await checks.run('L7', 'null removes an inherited entry', () => {
      let flat = flattenInheritance([
        { imports: { a: '/p/a.js', drop: '/p/drop.js' } },
        { imports: { drop: null } },
      ]);
      assert(!('drop' in flat.imports), 'a removed entry is absent, not blank');
      assertEqual(
        resolveSpecifier({
          specifier: 'drop',
          fromUrl: '/c/app.js',
          imports: flat.imports,
          scopes: flat.scopes,
        }),
        undefined,
        'and therefore unresolvable',
      );
    });

    // The dedupe corollary. An override that stopped at the top level would
    // leave a vendored package importing the parent's copy — two copies of
    // one library in one document.
    await checks.run(
      'L7',
      'an override reaches inside an inherited scope',
      () => {
        let flat = flattenInheritance([
          {
            imports: { lib: '/p/lib@1.js' },
            scopes: { '/p/widget@2/': { lib: '/p/lib@1.js' } },
          },
          { imports: { lib: '/c/lib@2.js' } },
        ]);
        assertEqual(
          resolveSpecifier({
            specifier: 'lib',
            fromUrl: '/p/widget@2/w.js',
            imports: flat.imports,
            scopes: flat.scopes,
          }),
          '/c/lib@2.js',
          'the scoped entry follows the override',
        );
      },
    );

    await checks.run(
      'L7',
      'a scope the child declares outranks that rebind',
      () => {
        let flat = flattenInheritance([
          { imports: { lib: '/p/lib@1.js' } },
          {
            imports: { lib: '/c/lib@2.js' },
            scopes: { '/p/pinned@1/': { lib: '/p/lib@1.js' } },
          },
        ]);
        assertEqual(
          resolveSpecifier({
            specifier: 'lib',
            fromUrl: '/p/pinned@1/x.js',
            imports: flat.imports,
            scopes: flat.scopes,
          }),
          '/p/lib@1.js',
          'a dependency may keep a version the child does not use',
        );
      },
    );

    // L4 is the only reason inheriting from a parent is safe at all.
    await checks.run('L4', 'a parent is named as an exact version', () => {
      assert(isExactParent('acme/blog@1.2.3'), 'exact');
      assert(!isExactParent('acme/blog@latest'), 'a tag is refused');
      assert(!isExactParent('acme/blog@^1.2.3'), 'a range is refused');
    });

    // ---- L11 re-homing is enumerated, never guessed -----------------------
    //
    // Moving a tree means deciding, for every URL-shaped string in it,
    // whether to touch it. Implementations that answer by pattern-matching
    // corrupt data the first time a value merely LOOKS like a reference, and
    // the damage is silent. These two checks are the contract that makes
    // that impossible.
    await checks.run('L11', 'data is never rewritten, whatever it matches', () => {
      let imports = { '@base/': 'https://cardstack.example/base/' };
      // Both of these match a rule. Neither is a reference.
      for (let value of [
        'https://cardstack.example/base/looks-like-a-module',
        'https://images.example/icon.png',
      ]) {
        assertEqual(
          classifyReference({ value, role: 'opaque', imports }).action,
          'leave',
          `opaque ${value}`,
        );
      }
    });

    await checks.run('L11', 'only a declared dependency rebinds', () => {
      let imports = { '@base/': 'https://cardstack.example/base/' };
      assertEqual(
        classifyReference({
          value: 'https://cardstack.example/base/string',
          role: 'reference',
          imports,
        }).action,
        'rebind',
        'declared',
      );
      // Absolute, a genuine reference, and not in the decklist: it survives
      // untouched, because rewriting it would point it at nothing.
      assertEqual(
        classifyReference({
          value: 'https://elsewhere.example/card.json',
          role: 'reference',
          imports,
        }).action,
        'leave',
        'undeclared',
      );
    });

    // A pack states what it assumed about its recipient. An implementation
    // that reads a mode it does not know as "the ordinary one" would produce
    // a confidently wrong intake — the artifact would look carried when part
    // of it was pruned under rules this build cannot honour.
    await checks.run('L11', 'an unrecognised pack mode is refused', () => {
      let packlist = createPacklist(
        fixtureFiles().map((f) => ({
          path: f.path,
          size: f.bytes.length,
          sha256: hashBytes(f.bytes),
        })),
        { mode: 'bare' },
      );
      let raw = JSON.parse(serializePacklist(packlist).toString('utf8'));
      raw.provenance.mode = 'negotiated';
      let refused = false;
      try {
        parsePacklist(Buffer.from(JSON.stringify(raw)));
      } catch {
        refused = true;
      }
      assert(refused, 'an unknown mode was accepted');
    });

    // An import the graph cannot see makes two of Deck's promises false at
    // once — the preload closure claims to name every URL a page requests,
    // and L6 says a sealed deck reaches nothing at runtime. An
    // implementation that skips these edges reports a shorter graph and a
    // clean bill of health for a tree that will fetch from anywhere.
    await checks.run('L6', 'a computed dynamic import is not silently dropped', () => {
      assertEqual(
        unanalyzableDynamicImports("await import(whichever);\n").length,
        1,
        'import(expr)',
      );
      assertEqual(
        unanalyzableDynamicImports('await import(`./l/${x}.js`);\n').length,
        1,
        'template',
      );
    });

    // Worse than dropping: inventing. A specifier that is only the START of
    // an expression is not an edge, and recording it puts a module in the
    // graph that does not exist while the real one stays invisible.
    await checks.run('L6', 'a partial specifier is not recorded as an edge', () => {
      let source = "await import('./locales/' + lang);\n";
      assertEqual(moduleSpecifiers(source).length, 0, 'no phantom edge');
      assertEqual(unanalyzableDynamicImports(source).length, 1, 'counted instead');
    });

    // ---- L8 provenance ---------------------------------------------------
    await checks.run('L8', 'a deck declares its own identity in its map', () => {
      let opened = unpack(sealed);
      let map = JSON.parse(
        opened.files.get('importmap.json')!.toString('utf8'),
      );
      assertEqual(
        map.deck.packages[FIXTURE_PACKAGE].version,
        FIXTURE_VERSION,
        'declared version',
      );
    });

    // ---- L9 / L10 --------------------------------------------------------
    await checks.run('L9', 'a signature verifies for its tree and no other', () => {
      let key = generateKeyPair();
      let signature = signTreeHash({ treeHash: FIXTURE_TREE_HASH, key });
      assert(
        verifySignature(FIXTURE_TREE_HASH, signature),
        'a fresh signature did not verify',
      );
      assert(
        !verifySignature('0'.repeat(64), signature),
        'a signature verified for the wrong tree',
      );
    });

    await checks.run('L9', 'the signed payload is the canonical two lines', () => {
      assertEqual(
        signingPayload(FIXTURE_TREE_HASH).toString('utf8'),
        `deck-sig-v1\ntree-hash-v1:${FIXTURE_TREE_HASH}\n`,
        'payload',
      );
    });

    await checks.run('L10', 'endorsements follow the bytes, not the name', async () => {
      let key = generateKeyPair();
      await appendSignature(
        storeDir,
        FIXTURE_TREE_HASH,
        signTreeHash({ treeHash: FIXTURE_TREE_HASH, key }),
      );
      // A second publisher, same bytes, nothing signed for it.
      await publishToStore(storeDir, 'other/fixture', FIXTURE_VERSION, sealed);
      let envelope = await readEnvelope(storeDir, FIXTURE_TREE_HASH);
      assertEqual(
        verifyEnvelope(FIXTURE_TREE_HASH, envelope!).valid.length,
        1,
        'the second publisher of identical bytes sees the endorsement',
      );
    });

    // ---- A3/A4: derived trees are their own subject ----------------------
    await checks.run('L9', 'a derived tree does not inherit the source endorsement', async () => {
      let derived = await deriveMinified({
        packBytes: sealed,
        sourceVersion: FIXTURE_VERSION,
        packageName: name,
        terserVersion: await terserVersion(),
      });
      let derivedHash = unpack(derivedPack(derived)).treeHash;
      assert(
        derivedHash !== FIXTURE_TREE_HASH,
        'a minified tree must be a different subject',
      );
      // FIXTURE_TREE_HASH was endorsed earlier in this run.
      let envelope = await readEnvelope(storeDir, derivedHash);
      assertEqual(
        summarizeEnvelope(derivedHash, envelope).length,
        0,
        'signing the source must not endorse a projection of it',
      );
    });

    await checks.run('L11', 'a derivation re-runs to the same tree', async () => {
      let tool = await terserVersion();
      let derived = await deriveMinified({
        packBytes: sealed,
        sourceVersion: FIXTURE_VERSION,
        packageName: name,
        terserVersion: tool,
      });
      let verdict = await verifyDerivation({
        sourcePack: sealed,
        derivedTreeHash: unpack(derivedPack(derived)).treeHash,
        derivation: derived.derivation,
        sourceVersion: FIXTURE_VERSION,
        packageName: name,
        version: derived.version,
        terserVersion: tool,
      });
      assert(verdict.ok, verdict.detail ?? 'the derivation did not reproduce');
    });

    // ---- L11 fail closed -------------------------------------------------
    // The law that was half-true: provenance recorded and never checked.
    await checks.run('L11', 'a stale pin is refused, not served', async () => {
      let deckDir = join(root, 'link-check');
      await mkdir(deckDir, { recursive: true });
      await writeFile(
        join(deckDir, 'importmap.json'),
        JSON.stringify({
          imports: {
            [`${name}/`]: `/r/${name}@9.9.9/`,
            [name]: `/r/${name}@9.9.9/index.js`,
          },
          deck: {
            packages: { probe: { version: '1.0.0' } },
            dependencies: { [name]: FIXTURE_VERSION },
          },
        }),
      );
      let report = await verifyLinks({
        depotName: 'r',
        storeDir,
        deck: 'x/probe',
        deckDir,
      });
      assert(
        report.findings.some((finding) => finding.code === 'link-integrity'),
        `a pin at 9.9.9 for a dependency declared ${FIXTURE_VERSION} was accepted`,
      );
    });

    await checks.run('L11', 'a pin with no dependency record is refused', async () => {
      let deckDir = join(root, 'orphan-pin');
      await mkdir(deckDir, { recursive: true });
      await writeFile(
        join(deckDir, 'importmap.json'),
        JSON.stringify({
          imports: { stray: `/r/${name}@${FIXTURE_VERSION}/index.js` },
          deck: { packages: { probe: { version: '1.0.0' } } },
        }),
      );
      let report = await verifyLinks({
        depotName: 'r',
        storeDir,
        deck: 'x/probe',
        deckDir,
      });
      assert(
        report.findings.some((finding) => finding.code === 'link-missing-record'),
        'an orphan pin was accepted',
      );
    });

    await checks.run('L11', 'honest links pass', async () => {
      let deckDir = join(root, 'honest');
      await mkdir(deckDir, { recursive: true });
      await writeFile(
        join(deckDir, 'importmap.json'),
        JSON.stringify({
          imports: {
            [`${name}/`]: `/r/${name}@${FIXTURE_VERSION}/`,
            [name]: `/r/${name}@${FIXTURE_VERSION}/index.js`,
          },
          deck: {
            packages: { probe: { version: '1.0.0' } },
            dependencies: { [name]: FIXTURE_VERSION },
          },
        }),
      );
      let report = await verifyLinks({
        depotName: 'r',
        storeDir,
        deck: 'x/probe',
        deckDir,
      });
      assertEqual(
        report.findings.map((f) => `${f.code} ${f.specifier}`).join(', '),
        '',
        'honest links reported problems',
      );
    });

    await checks.run('L11', 'an invalid package name is refused', async () => {
      let refused = false;
      try {
        await publishToStore(storeDir, 'Not A Name', '1.0.0', sealed);
      } catch {
        refused = true;
      }
      assert(refused, 'an invalid package name was accepted');
    });

    await checks.run('L11', 'a non-canonical version is refused', async () => {
      let refused = false;
      try {
        await publishToStore(storeDir, name, 'v1.0', sealed);
      } catch {
        refused = true;
      }
      assert(refused, 'a non-canonical version was accepted');
    });

    await checks.run('L11', 'latest may not point at a prerelease', async () => {
      let refused = false;
      try {
        await publishToStore(storeDir, name, '2.0.0-dev.1', sealed, {
          tag: 'latest',
        });
      } catch {
        refused = true;
      }
      assert(refused, 'latest was pointed at a prerelease');
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }

  return checks.results;
}
