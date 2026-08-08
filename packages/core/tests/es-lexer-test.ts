import QUnit from 'qunit';
const { module, test } = QUnit;
import {
  isCommonJsModule,
  lexModule,
  moduleSpecifiers,
} from '../src/es-lexer.ts';

module('the ES module lexer', () => {
  test('every static form', (assert) => {
    assert.deepEqual(
      moduleSpecifiers(`
        import './side-effect.js';
        import a from './default.js';
        import { b } from './named.js';
        import { c as d } from './renamed.js';
        import * as e from './namespace.js';
        import f, { g } from './both.js';
        import h, * as i from './default-and-ns.js';
        import type { J } from './types.js';
        export { k } from './re-export.js';
        export * from './star.js';
        export * as ns from './star-as.js';
        export { default as m } from './default-re-export.js';
      `).sort(),
      [
        './both.js',
        './default-and-ns.js',
        './default-re-export.js',
        './default.js',
        './named.js',
        './namespace.js',
        './re-export.js',
        './renamed.js',
        './side-effect.js',
        './star-as.js',
        './star.js',
        './types.js',
      ],
    );
  });

  test('multi-line clauses', (assert) => {
    assert.deepEqual(
      moduleSpecifiers("import {\n  One,\n  Two,\n} from '../lib/pair.js';\n"),
      ['../lib/pair.js'],
    );
  });

  test('dynamic import and import.meta.resolve', (assert) => {
    assert.deepEqual(
      moduleSpecifiers(
        "const m = await import('./lazy.js');\nconst u = import.meta.resolve('./asset.png');\n",
      ).sort(),
      ['./asset.png', './lazy.js'],
    );
  });

  test('a declaration that only declares has no specifier', (assert) => {
    assert.deepEqual(
      moduleSpecifiers(
        "export const from = 1;\nexport default function () {}\nexport class X {}\nexport let y, z;\n",
      ),
      [],
    );
  });

  // Each of these is a real package that broke the regex scanner.
  test('leaflet: prose containing the word from', (assert) => {
    assert.deepEqual(
      moduleSpecifiers(
        `import {toPoint} from '../geometry/Point';\n` +
          `export var Marker = Layer.extend({\n` +
          `  // @option icon: Icon = *\n` +
          `  icon: new IconDefault(),\n` +
          `  // Option inherited from "Interactive layer"\n` +
          `  opacity: 1,\n});\n`,
      ),
      ['../geometry/Point'],
    );
  });

  test('standardized-audio-context: import syntax inside a comment', (assert) => {
    assert.deepEqual(
      moduleSpecifiers(
        `/*\n * import defaultImport from './path';\n * import { named } from './path';\n */\n` +
          `// import { x } from 'ghost';\n` +
          `import { real } from './real.js';\n`,
      ),
      ['./real.js'],
    );
  });

  test('a regex literal containing // does not eat the next line', (assert) => {
    assert.deepEqual(
      moduleSpecifiers(
        "const RX = /https?:\\/\\//g;\nimport { a } from './a.js';\n",
      ),
      ['./a.js'],
    );
  });

  test('division is not a regex', (assert) => {
    assert.deepEqual(
      moduleSpecifiers("const ratio = width / height;\nimport x from './x.js';\n"),
      ['./x.js'],
    );
  });

  test('a specifier-looking string in ordinary code is not an import', (assert) => {
    assert.deepEqual(
      moduleSpecifiers(
        "const doc = \"import { x } from 'not-real'\";\nconst t = `import y from 'also-not'`;\n",
      ),
      [],
    );
  });

  test('a template substitution does not confuse the scanner', (assert) => {
    assert.deepEqual(
      moduleSpecifiers(
        "const s = `a${ `nested ${ 1 } ` }b`;\nimport { z } from './z.js';\n",
      ),
      ['./z.js'],
    );
  });

  test('property accesses named import or export are not declarations', (assert) => {
    assert.deepEqual(
      moduleSpecifiers(
        "obj.import = 1;\nthing.export = 2;\nimport a from './a.js';\n",
      ),
      ['./a.js'],
    );
  });

  test('highlight.js: an ESM entry over a CommonJS core', (assert) => {
    assert.false(
      isCommonJsModule("import hljs from '../lib/index.js';\nexport default hljs;\n"),
      'the ESM wrapper is ESM',
    );
    assert.true(
      isCommonJsModule('var hljs = require("./core.js");\nmodule.exports = hljs;\n'),
      'the core it imports is CommonJS',
    );
  });

  test('CommonJS words inside strings and comments do not count', (assert) => {
    assert.false(
      isCommonJsModule(
        "// module.exports = x\nconst s = 'require(\"y\")';\nexport const a = 1;\n",
      ),
    );
  });

  test('offsets point at the specifier, exclusive of quotes', (assert) => {
    let source = "import a from './x.js';";
    let [found] = lexModule(source).specifiers;
    assert.strictEqual(source.slice(found.start, found.end), './x.js');
    assert.strictEqual(found.kind, 'static-import');
  });

  test('an unterminated string does not hang or run away', (assert) => {
    assert.deepEqual(moduleSpecifiers("import a from './x\nimport b from './y.js';\n"), [
      './y.js',
    ]);
  });

  // `require` and `exports` already required a bare occurrence; `module` did
  // not, so a property chain on somebody else's object read as CommonJS.
  test('a property chain named module.exports is not CommonJS', (assert) => {
    assert.false(
      isCommonJsModule('export const a = 1;\nconsole.log(foo.module.exports);\n'),
      'foo.module.exports belongs to foo',
    );
    assert.false(
      isCommonJsModule('export const a = 1;\nthis.module.exports = 2;\n'),
    );
    assert.true(
      isCommonJsModule('module.exports = { a: 1 };\n'),
      'the real one still counts',
    );
  });

  // Without an identifier-boundary check the tail matched by prefix.
  test('module.exportsSomething is not module.exports', (assert) => {
    assert.false(isCommonJsModule('export const a = 1;\nmodule.exportsAll();\n'));
    assert.true(isCommonJsModule('module . exports = 1;\n'), 'trivia is allowed');
  });
});
