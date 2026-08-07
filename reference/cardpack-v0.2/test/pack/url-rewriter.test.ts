import { describe, it, expect } from 'vitest';
import {
  rewriteJsonUrls,
  rewriteGtsUrls,
  rewriteUrls,
  parseRewriteArgs,
} from '../../src/pack/url-rewriter.js';

describe('rewriteJsonUrls', () => {
  const rules = [{ from: 'https://old-realm.boxel.ai/', to: 'https://new-realm.boxel.ai/' }];

  it('rewrites meta.adoptsFrom.module', () => {
    const input = Buffer.from(
      JSON.stringify({
        meta: {
          adoptsFrom: { module: 'https://old-realm.boxel.ai/blog-post', name: 'BlogPost' },
        },
      }),
    );

    const result = rewriteJsonUrls(input, rules);
    const parsed = JSON.parse(result.content.toString());
    expect(parsed.meta.adoptsFrom.module).toBe('https://new-realm.boxel.ai/blog-post');
    expect(result.rewriteCount).toBe(1);
  });

  it('rewrites relationships.*.links.self', () => {
    const input = Buffer.from(
      JSON.stringify({
        relationships: {
          author: { links: { self: 'https://old-realm.boxel.ai/Author/jane' } },
        },
      }),
    );

    const result = rewriteJsonUrls(input, rules);
    const parsed = JSON.parse(result.content.toString());
    expect(parsed.relationships.author.links.self).toBe(
      'https://new-realm.boxel.ai/Author/jane',
    );
    expect(result.rewriteCount).toBe(1);
  });

  it('rewrites arbitrary string values matching prefix', () => {
    const input = Buffer.from(
      JSON.stringify({
        attributes: {
          link: 'https://old-realm.boxel.ai/some/resource',
          normal: 'just a string',
        },
      }),
    );

    const result = rewriteJsonUrls(input, rules);
    const parsed = JSON.parse(result.content.toString());
    expect(parsed.attributes.link).toBe('https://new-realm.boxel.ai/some/resource');
    expect(parsed.attributes.normal).toBe('just a string');
    expect(result.rewriteCount).toBe(1);
  });

  it('leaves non-matching URLs untouched', () => {
    const input = Buffer.from(
      JSON.stringify({
        meta: { adoptsFrom: { module: '../local-card', name: 'Card' } },
      }),
    );

    const result = rewriteJsonUrls(input, rules);
    const parsed = JSON.parse(result.content.toString());
    expect(parsed.meta.adoptsFrom.module).toBe('../local-card');
    expect(result.rewriteCount).toBe(0);
  });

  it('handles multiple rewrite rules', () => {
    const multiRules = [
      { from: 'https://a.com/', to: 'https://x.com/' },
      { from: 'https://b.com/', to: 'https://y.com/' },
    ];

    const input = Buffer.from(
      JSON.stringify({
        attributes: {
          linkA: 'https://a.com/foo',
          linkB: 'https://b.com/bar',
        },
      }),
    );

    const result = rewriteJsonUrls(input, multiRules);
    const parsed = JSON.parse(result.content.toString());
    expect(parsed.attributes.linkA).toBe('https://x.com/foo');
    expect(parsed.attributes.linkB).toBe('https://y.com/bar');
    expect(result.rewriteCount).toBe(2);
  });

  it('returns rewriteCount 0 when nothing matches', () => {
    const input = Buffer.from(JSON.stringify({ attributes: { title: 'Hello' } }));
    const result = rewriteJsonUrls(input, rules);
    expect(result.rewriteCount).toBe(0);
  });

  it('returns unchanged content for non-JSON input', () => {
    const input = Buffer.from('not json');
    const result = rewriteJsonUrls(input, rules);
    expect(result.content.equals(input)).toBe(true);
    expect(result.rewriteCount).toBe(0);
  });

  it('returns unchanged content when rules are empty', () => {
    const input = Buffer.from(JSON.stringify({ a: 1 }));
    const result = rewriteJsonUrls(input, []);
    expect(result.rewriteCount).toBe(0);
  });
});

describe('rewriteGtsUrls', () => {
  const rules = [{ from: 'https://old-realm.boxel.ai/', to: 'https://new-realm.boxel.ai/' }];

  it('rewrites import specifiers', () => {
    const input = Buffer.from(
      `import { CardDef } from 'https://old-realm.boxel.ai/card-api';`,
    );

    const result = rewriteGtsUrls(input, rules);
    expect(result.content.toString()).toBe(
      `import { CardDef } from 'https://new-realm.boxel.ai/card-api';`,
    );
    expect(result.rewriteCount).toBe(1);
  });

  it('rewrites multiple imports', () => {
    const input = Buffer.from(
      `import { A } from 'https://old-realm.boxel.ai/a';\nimport { B } from 'https://old-realm.boxel.ai/b';`,
    );

    const result = rewriteGtsUrls(input, rules);
    const lines = result.content.toString().split('\n');
    expect(lines[0]).toContain('https://new-realm.boxel.ai/a');
    expect(lines[1]).toContain('https://new-realm.boxel.ai/b');
    expect(result.rewriteCount).toBe(2);
  });

  it('leaves relative imports untouched', () => {
    const input = Buffer.from(`import { Author } from './author';`);
    const result = rewriteGtsUrls(input, rules);
    expect(result.content.toString()).toBe(`import { Author } from './author';`);
    expect(result.rewriteCount).toBe(0);
  });

  it('handles double-quoted imports', () => {
    const input = Buffer.from(
      `import { X } from "https://old-realm.boxel.ai/x";`,
    );

    const result = rewriteGtsUrls(input, rules);
    expect(result.content.toString()).toContain('https://new-realm.boxel.ai/x');
    expect(result.rewriteCount).toBe(1);
  });

  it('returns unchanged content when rules are empty', () => {
    const input = Buffer.from(`import { A } from 'https://old-realm.boxel.ai/a';`);
    const result = rewriteGtsUrls(input, []);
    expect(result.rewriteCount).toBe(0);
  });
});

describe('rewriteUrls', () => {
  const rules = [{ from: 'https://old/', to: 'https://new/' }];

  it('dispatches to JSON handler for .json files', () => {
    const input = Buffer.from(
      JSON.stringify({ attributes: { url: 'https://old/x' } }),
    );
    const result = rewriteUrls(input, 'data.json', rules);
    const parsed = JSON.parse(result.content.toString());
    expect(parsed.attributes.url).toBe('https://new/x');
  });

  it('dispatches to GTS handler for .gts files', () => {
    const input = Buffer.from(`import { A } from 'https://old/a';`);
    const result = rewriteUrls(input, 'card.gts', rules);
    expect(result.content.toString()).toContain('https://new/a');
  });

  it('returns unchanged for unsupported extensions', () => {
    const input = Buffer.from('binary content');
    const result = rewriteUrls(input, 'image.png', rules);
    expect(result.content.equals(input)).toBe(true);
    expect(result.rewriteCount).toBe(0);
  });
});

describe('parseRewriteArgs', () => {
  it('pairs arguments into rules', () => {
    const rules = parseRewriteArgs(['https://a/', 'https://b/', 'https://c/', 'https://d/']);
    expect(rules).toHaveLength(2);
    expect(rules[0]).toEqual({ from: 'https://a/', to: 'https://b/' });
    expect(rules[1]).toEqual({ from: 'https://c/', to: 'https://d/' });
  });

  it('throws on odd-length input', () => {
    expect(() => parseRewriteArgs(['https://a/', 'https://b/', 'https://c/'])).toThrow(
      'requires pairs',
    );
  });

  it('handles single pair', () => {
    const rules = parseRewriteArgs(['from', 'to']);
    expect(rules).toEqual([{ from: 'from', to: 'to' }]);
  });

  it('returns empty array for empty input', () => {
    expect(parseRewriteArgs([])).toEqual([]);
  });
});
