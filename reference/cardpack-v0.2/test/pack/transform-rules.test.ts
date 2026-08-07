import { describe, it, expect } from 'vitest';
import {
  parseTransformArg,
  matchTransformRule,
  matchGlob,
} from '../../src/pack/transform-rules.js';

describe('parseTransformArg', () => {
  it('parses exclude rule', () => {
    const spec = parseTransformArg('Customer/*:exclude');
    expect(spec).toEqual({ pattern: 'Customer/*', rule: 'exclude' });
  });

  it('parses copy rule', () => {
    const spec = parseTransformArg('images/*:copy');
    expect(spec).toEqual({ pattern: 'images/*', rule: 'copy' });
  });

  it('parses export rule with transform name', () => {
    const spec = parseTransformArg('Author/*:export:sanitize-pii');
    expect(spec).toEqual({
      pattern: 'Author/*',
      rule: 'export',
      transform: 'sanitize-pii',
    });
  });

  it('parses reference rule with URL (containing colons)', () => {
    const spec = parseTransformArg('*.gts:reference:https://catalog.boxel.ai/base/');
    expect(spec).toEqual({
      pattern: '*.gts',
      rule: 'reference',
      referenceUrl: 'https://catalog.boxel.ai/base/',
    });
  });

  it('throws on missing rule part', () => {
    expect(() => parseTransformArg('Customer/*')).toThrow('expected "glob:rule"');
  });

  it('throws on invalid rule name', () => {
    expect(() => parseTransformArg('Customer/*:delete')).toThrow('Invalid transform rule');
  });

  it('throws on export without transform name', () => {
    expect(() => parseTransformArg('Author/*:export')).toThrow('requires a transform name');
  });

  it('throws on reference without URL', () => {
    expect(() => parseTransformArg('*.gts:reference')).toThrow('requires a URL');
  });
});

describe('matchGlob', () => {
  it('* matches everything', () => {
    expect(matchGlob('anything.json', '*')).toBe(true);
    expect(matchGlob('dir/file.gts', '*')).toBe(true);
  });

  it('*.ext matches files by extension', () => {
    expect(matchGlob('card.gts', '*.gts')).toBe(true);
    expect(matchGlob('nested/card.gts', '*.gts')).toBe(true);
    expect(matchGlob('card.json', '*.gts')).toBe(false);
  });

  it('Dir/* matches files directly in Dir', () => {
    expect(matchGlob('Customer/john.json', 'Customer/*')).toBe(true);
    expect(matchGlob('Customer/jane.json', 'Customer/*')).toBe(true);
  });

  it('Dir/* does NOT match nested files', () => {
    expect(matchGlob('Customer/nested/deep.json', 'Customer/*')).toBe(false);
  });

  it('Dir/** matches files recursively', () => {
    expect(matchGlob('Customer/john.json', 'Customer/**')).toBe(true);
    expect(matchGlob('Customer/nested/deep.json', 'Customer/**')).toBe(true);
  });

  it('Dir/** does NOT match files outside Dir', () => {
    expect(matchGlob('Author/jane.json', 'Customer/**')).toBe(false);
  });

  it('exact match works', () => {
    expect(matchGlob('blog-post.gts', 'blog-post.gts')).toBe(true);
    expect(matchGlob('other.gts', 'blog-post.gts')).toBe(false);
  });

  it('exact match with path works', () => {
    expect(matchGlob('BlogPost/welcome.json', 'BlogPost/welcome.json')).toBe(true);
    expect(matchGlob('BlogPost/other.json', 'BlogPost/welcome.json')).toBe(false);
  });
});

describe('matchTransformRule', () => {
  it('returns first matching rule', () => {
    const rules = [
      { pattern: 'Draft/*', rule: 'exclude' as const },
      { pattern: '*.gts', rule: 'copy' as const },
    ];

    expect(matchTransformRule('Draft/post.json', rules).rule).toBe('exclude');
    expect(matchTransformRule('card.gts', rules).rule).toBe('copy');
  });

  it('first match wins when multiple rules match', () => {
    const rules = [
      { pattern: '*:exclude', rule: 'exclude' as const },
      { pattern: '*.gts', rule: 'copy' as const },
    ];

    // The first rule won't match because '*:exclude' is not a valid glob for 'card.gts'
    // Let's use a proper overlapping example:
    const rules2 = [
      { pattern: '*.json', rule: 'exclude' as const },
      { pattern: 'Author/*', rule: 'export' as const, transform: 'sanitize-pii' },
    ];

    // Author/jane.json matches *.json first
    expect(matchTransformRule('Author/jane.json', rules2).rule).toBe('exclude');
  });

  it('defaults to copy when no rules match', () => {
    const rules = [{ pattern: 'Draft/*', rule: 'exclude' as const }];
    const result = matchTransformRule('card.gts', rules);
    expect(result.rule).toBe('copy');
  });

  it('defaults to copy when rules array is empty', () => {
    const result = matchTransformRule('anything.json', []);
    expect(result.rule).toBe('copy');
  });
});
