import { describe, it, expect } from 'vitest';
import {
  createManifest,
  serializeManifest,
  parseManifest,
  validateManifestStructure,
  validateManifestAgainstFiles,
  computeSha256,
  CARDPACK_FORMAT_VERSION,
  type ManifestCard,
  type ManifestEntry,
} from '../../src/pack/manifest.js';

describe('computeSha256', () => {
  it('returns consistent hash for same content', () => {
    const content = Buffer.from('hello world');
    const hash1 = computeSha256(content);
    const hash2 = computeSha256(content);
    expect(hash1).toBe(hash2);
  });

  it('returns different hashes for different content', () => {
    const hash1 = computeSha256(Buffer.from('hello'));
    const hash2 = computeSha256(Buffer.from('world'));
    expect(hash1).not.toBe(hash2);
  });

  it('returns a 64-character hex string', () => {
    const hash = computeSha256(Buffer.from('test'));
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('matches known sha256 value', () => {
    // sha256 of empty string
    const hash = computeSha256(Buffer.from(''));
    expect(hash).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  });
});

describe('createManifest', () => {
  it('creates a manifest with correct structure', () => {
    const entries: ManifestEntry[] = [
      { path: 'test.json', contentType: 'application/json', size: 100, hash: 'abc123', rule: 'copy' },
    ];

    const manifest = createManifest({ entries });

    expect(manifest.meta.adoptsFrom.module).toBe('@cardstack/cardpack');
    expect(manifest.meta.adoptsFrom.name).toBe('Manifest');
    expect(manifest.attributes.version).toBe(CARDPACK_FORMAT_VERSION);
    expect(manifest.attributes.createdBy).toBe('unknown');
    expect(manifest.attributes.sourceRealm).toBe('local');
    expect(manifest.attributes.entries).toEqual(entries);
    expect(manifest.attributes.createdAt).toBeTruthy();
  });

  it('uses provided options', () => {
    const manifest = createManifest({
      entries: [],
      sourceRealm: 'https://app.boxel.ai/user/workspace',
      description: 'Test pack',
      createdBy: '@user:boxel.ai',
    });

    expect(manifest.attributes.sourceRealm).toBe('https://app.boxel.ai/user/workspace');
    expect(manifest.attributes.description).toBe('Test pack');
    expect(manifest.attributes.createdBy).toBe('@user:boxel.ai');
  });
});

describe('serializeManifest / parseManifest', () => {
  it('round-trips correctly', () => {
    const entries: ManifestEntry[] = [
      { path: 'file.gts', contentType: 'application/vnd.card+source', size: 500, hash: 'def456', rule: 'copy' },
      { path: 'Card/instance.json', contentType: 'application/json', size: 200, hash: 'ghi789', rule: 'copy' },
    ];

    const original = createManifest({
      entries,
      sourceRealm: 'https://example.com',
      description: 'Round-trip test',
      createdBy: '@test:boxel.ai',
    });

    const json = serializeManifest(original);
    const parsed = parseManifest(json);

    expect(parsed.meta).toEqual(original.meta);
    expect(parsed.attributes.version).toBe(original.attributes.version);
    expect(parsed.attributes.createdAt).toBe(original.attributes.createdAt);
    expect(parsed.attributes.createdBy).toBe(original.attributes.createdBy);
    expect(parsed.attributes.sourceRealm).toBe(original.attributes.sourceRealm);
    expect(parsed.attributes.description).toBe(original.attributes.description);
    expect(parsed.attributes.entries).toEqual(original.attributes.entries);
  });

  it('produces valid JSON', () => {
    const manifest = createManifest({ entries: [] });
    const json = serializeManifest(manifest);
    expect(() => JSON.parse(json)).not.toThrow();
  });
});

describe('validateManifestStructure', () => {
  function validManifest(): ManifestCard {
    return createManifest({
      entries: [
        { path: 'test.json', contentType: 'application/json', size: 10, hash: 'abc', rule: 'copy' },
      ],
    });
  }

  it('accepts a valid manifest', () => {
    expect(() => validateManifestStructure(validManifest())).not.toThrow();
  });

  it('rejects null', () => {
    expect(() => validateManifestStructure(null)).toThrow('must be a JSON object');
  });

  it('rejects missing meta', () => {
    const m = validManifest();
    delete (m as Record<string, unknown>).meta;
    expect(() => validateManifestStructure(m)).toThrow('"meta"');
  });

  it('rejects missing meta.adoptsFrom', () => {
    const m = validManifest();
    (m.meta as Record<string, unknown>).adoptsFrom = undefined;
    expect(() => validateManifestStructure(m)).toThrow('"meta.adoptsFrom"');
  });

  it('rejects missing attributes', () => {
    const m = validManifest();
    delete (m as Record<string, unknown>).attributes;
    expect(() => validateManifestStructure(m)).toThrow('"attributes"');
  });

  it('rejects missing version', () => {
    const m = validManifest();
    (m.attributes as Record<string, unknown>).version = undefined;
    expect(() => validateManifestStructure(m)).toThrow('"attributes.version"');
  });

  it('rejects missing createdAt', () => {
    const m = validManifest();
    (m.attributes as Record<string, unknown>).createdAt = undefined;
    expect(() => validateManifestStructure(m)).toThrow('"attributes.createdAt"');
  });

  it('rejects missing entries array', () => {
    const m = validManifest();
    (m.attributes as Record<string, unknown>).entries = 'not-array';
    expect(() => validateManifestStructure(m)).toThrow('"attributes.entries"');
  });

  it('rejects entry missing path', () => {
    const m = validManifest();
    delete (m.attributes.entries[0] as Record<string, unknown>).path;
    expect(() => validateManifestStructure(m)).toThrow('entry missing "path"');
  });

  it('rejects entry missing contentType', () => {
    const m = validManifest();
    delete (m.attributes.entries[0] as Record<string, unknown>).contentType;
    expect(() => validateManifestStructure(m)).toThrow('missing "contentType"');
  });

  it('rejects entry missing size', () => {
    const m = validManifest();
    delete (m.attributes.entries[0] as Record<string, unknown>).size;
    expect(() => validateManifestStructure(m)).toThrow('missing "size"');
  });

  it('rejects entry missing hash', () => {
    const m = validManifest();
    delete (m.attributes.entries[0] as Record<string, unknown>).hash;
    expect(() => validateManifestStructure(m)).toThrow('missing "hash"');
  });
});

describe('validateManifestAgainstFiles', () => {
  it('passes when manifest matches files', () => {
    const manifest = createManifest({
      entries: [
        { path: 'a.json', contentType: 'application/json', size: 10, hash: 'aaa', rule: 'copy' },
        { path: 'b.gts', contentType: 'application/vnd.card+source', size: 20, hash: 'bbb', rule: 'copy' },
      ],
    });

    const files = new Map([
      ['a.json', { size: 10, hash: 'aaa' }],
      ['b.gts', { size: 20, hash: 'bbb' }],
    ]);

    const result = validateManifestAgainstFiles(manifest, files);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('reports missing files', () => {
    const manifest = createManifest({
      entries: [
        { path: 'missing.json', contentType: 'application/json', size: 10, hash: 'aaa', rule: 'copy' },
      ],
    });

    const result = validateManifestAgainstFiles(manifest, new Map());
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('missing.json');
    expect(result.errors[0]).toContain('missing from archive');
  });

  it('reports size mismatches', () => {
    const manifest = createManifest({
      entries: [
        { path: 'a.json', contentType: 'application/json', size: 10, hash: 'aaa', rule: 'copy' },
      ],
    });

    const files = new Map([['a.json', { size: 99, hash: 'aaa' }]]);

    const result = validateManifestAgainstFiles(manifest, files);
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('Size mismatch');
  });

  it('reports hash mismatches', () => {
    const manifest = createManifest({
      entries: [
        { path: 'a.json', contentType: 'application/json', size: 10, hash: 'aaa', rule: 'copy' },
      ],
    });

    const files = new Map([['a.json', { size: 10, hash: 'zzz' }]]);

    const result = validateManifestAgainstFiles(manifest, files);
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('Hash mismatch');
  });

  it('reports extra files in archive', () => {
    const manifest = createManifest({ entries: [] });

    const files = new Map([['extra.json', { size: 10, hash: 'aaa' }]]);

    const result = validateManifestAgainstFiles(manifest, files);
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('extra.json');
    expect(result.errors[0]).toContain('not listed in manifest');
  });

  it('ignores manifest.json in file list', () => {
    const manifest = createManifest({ entries: [] });

    const files = new Map([['manifest.json', { size: 100, hash: 'xxx' }]]);

    const result = validateManifestAgainstFiles(manifest, files);
    expect(result.valid).toBe(true);
  });
});
