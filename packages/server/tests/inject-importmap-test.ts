import QUnit from 'qunit';
const { module, test } = QUnit;
import { injectImportMap } from '../src/inject-importmap.ts';

const IMPORTS = { 'acme/palette': '/site/acme/palette@1.1.0/palette.js' };

module('import-map injection: making the map reach the browser', function () {
  test('an inert external map becomes the real one', function (assert) {
    let html = Buffer.from(
      `<!doctype html>\n<script type="importmap" src="./importmap.json"></script>\n<script type="module" src="./app.js"></script>`,
    );
    let { bytes, injected } = injectImportMap(html, IMPORTS);
    let text = bytes.toString();
    assert.true(injected);
    assert.false(
      text.includes('src="./importmap.json"'),
      'the tag that did nothing is gone',
    );
    assert.true(text.includes(`<script type="importmap">{"imports":`));
    assert.true(
      text.indexOf('type="importmap"') < text.indexOf('type="module"'),
      'a map must precede the modules it resolves',
    );
  });

  test('an author-written inline map is left alone', function (assert) {
    let html = Buffer.from(
      `<script type="importmap">{"imports":{"x":"/x.js"}}</script><script type="module" src="./app.js"></script>`,
    );
    let { bytes, injected } = injectImportMap(html, IMPORTS);
    assert.false(injected, 'merging two maps silently would be worse');
    assert.strictEqual(bytes.toString(), html.toString());
  });

  test('with no map tag, it lands before the first module script', function (assert) {
    let html = Buffer.from(
      `<head><title>a</title></head><body><script type="module" src="./app.js"></script></body>`,
    );
    let text = injectImportMap(html, IMPORTS).bytes.toString();
    assert.true(
      text.indexOf('type="importmap"') < text.indexOf('type="module"'),
      text,
    );
  });

  test('with no module script either, it lands in the head', function (assert) {
    let html = Buffer.from(`<head><title>a</title></head><body>hi</body>`);
    let text = injectImportMap(html, IMPORTS).bytes.toString();
    assert.true(text.indexOf('type="importmap"') < text.indexOf('</head>'));
  });

  test('nothing to inject changes nothing', function (assert) {
    let html = Buffer.from(`<script type="module" src="./app.js"></script>`);
    let { bytes, injected } = injectImportMap(html, {});
    assert.false(injected);
    assert.strictEqual(bytes.toString(), html.toString());
  });
});
