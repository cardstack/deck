import QUnit from 'qunit';
const { module, test } = QUnit;
import { readFile } from 'node:fs/promises';
import { dirname, join, resolve as resolvePath } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as root from '../src/index.ts';
import * as node from '../src/node.ts';

const src = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');

// Follow every relative import from a starting module and report which
// files the entry actually pulls in. A promise about an entry is a promise
// about its whole closure, not its first line.
async function closureOf(entry: string): Promise<string[]> {
  let seen = new Set<string>();
  let queue = [resolvePath(src, entry)];
  while (queue.length > 0) {
    let file = queue.pop()!;
    if (seen.has(file)) {
      continue;
    }
    seen.add(file);
    let text = await readFile(file, 'utf8');
    // `import type` is erased at runtime and by every bundler, so it is
    // not an edge. A VALUE import of the same module would be, which is
    // exactly the regression this test exists to catch.
    for (let match of text.matchAll(/(^|\n)\s*(import|export)\s+(?!type\s)[^;]*?from '(\.[^']+)'/g)) {
      queue.push(resolvePath(dirname(file), match[3]));
    }
  }
  return [...seen];
}

module('package entries', function () {
  // The claim the root entry makes about itself, checked rather than
  // asserted in a comment. eslint guards the named files; this guards the
  // closure, which is the thing that actually breaks a consumer's bundle.
  test('the root entry reaches no node: builtin', async function (assert) {
    let files = await closureOf('index.ts');
    let offenders: string[] = [];
    for (let file of files) {
      if (/from 'node:/.test(await readFile(file, 'utf8'))) {
        offenders.push(file.slice(src.length + 1));
      }
    }
    assert.deepEqual(
      offenders,
      [],
      'a module in the root closure imports a Node builtin',
    );
  });

  test('the root entry carries the resolution surface', function (assert) {
    for (let name of [
      'resolveSpecifier',
      'parseExtends',
      'flattenInheritance',
      'resolveInheritance',
      'classifyReference',
      'planPack',
      'parsePackages',
    ]) {
      assert.strictEqual(
        typeof (root as Record<string, unknown>)[name],
        'function',
        name,
      );
    }
  });

  // One import for an embedder, rather than a deep path per module. Deep
  // paths still resolve; they are how this repo imports, and they are not
  // what an embedder should have to learn.
  test('the node entry adds the filesystem surface, and re-exports the root', function (assert) {
    for (let name of [
      'treeHashFromDir',
      'pack',
      'unpack',
      'createPacklist',
      'intakeReadiness',
      'publishToStore',
      'verifyLinks',
    ]) {
      assert.strictEqual(
        typeof (node as Record<string, unknown>)[name],
        'function',
        name,
      );
    }
    assert.strictEqual(
      node.resolveSpecifier,
      root.resolveSpecifier,
      'one implementation, reachable from either entry',
    );
  });
});
