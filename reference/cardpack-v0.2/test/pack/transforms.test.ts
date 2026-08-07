import { describe, it, expect } from 'vitest';
import {
  getTransform,
  listTransforms,
  sanitizePii,
  defaultConfig,
  stripMetadata,
} from '../../src/pack/transforms.js';

const ctx = { filePath: 'test.json', contentType: 'application/json' };

describe('getTransform', () => {
  it('returns function for known transform names', () => {
    expect(typeof getTransform('sanitize-pii')).toBe('function');
    expect(typeof getTransform('default-config')).toBe('function');
    expect(typeof getTransform('strip-metadata')).toBe('function');
  });

  it('throws for unknown transform name', () => {
    expect(() => getTransform('nonexistent')).toThrow('Unknown transform');
  });
});

describe('listTransforms', () => {
  it('returns all built-in transform names', () => {
    const names = listTransforms();
    expect(names).toContain('sanitize-pii');
    expect(names).toContain('default-config');
    expect(names).toContain('strip-metadata');
    expect(names).toHaveLength(3);
  });
});

describe('sanitize-pii', () => {
  it('strips email addresses from JSON string values', () => {
    const input = Buffer.from(
      JSON.stringify({
        attributes: { name: 'Jane', email: 'jane@example.com' },
      }),
    );

    const result = sanitizePii(input, ctx);
    const parsed = JSON.parse(result.toString());
    expect(parsed.attributes.email).toBe('<email>');
    expect(parsed.attributes.name).toBe('Jane');
  });

  it('strips phone numbers', () => {
    const input = Buffer.from(
      JSON.stringify({
        attributes: { phone: '(555) 123-4567' },
      }),
    );

    const result = sanitizePii(input, ctx);
    const parsed = JSON.parse(result.toString());
    expect(parsed.attributes.phone).toBe('<phone>');
  });

  it('strips emails embedded in longer strings', () => {
    const input = Buffer.from(
      JSON.stringify({
        attributes: { bio: 'Contact me at user@test.com for info' },
      }),
    );

    const result = sanitizePii(input, ctx);
    const parsed = JSON.parse(result.toString());
    expect(parsed.attributes.bio).toBe('Contact me at <email> for info');
  });

  it('handles nested objects and arrays', () => {
    const input = Buffer.from(
      JSON.stringify({
        attributes: {
          contacts: [
            { email: 'a@b.com', name: 'A' },
            { email: 'c@d.com', name: 'C' },
          ],
        },
      }),
    );

    const result = sanitizePii(input, ctx);
    const parsed = JSON.parse(result.toString());
    expect(parsed.attributes.contacts[0].email).toBe('<email>');
    expect(parsed.attributes.contacts[1].email).toBe('<email>');
    expect(parsed.attributes.contacts[0].name).toBe('A');
  });

  it('preserves non-PII content', () => {
    const input = Buffer.from(
      JSON.stringify({
        meta: { adoptsFrom: { module: '../author', name: 'Author' } },
        attributes: { title: 'Hello World', count: 42 },
      }),
    );

    const result = sanitizePii(input, ctx);
    const parsed = JSON.parse(result.toString());
    expect(parsed.attributes.title).toBe('Hello World');
    expect(parsed.attributes.count).toBe(42);
    expect(parsed.meta.adoptsFrom.module).toBe('../author');
  });

  it('returns non-JSON content unchanged', () => {
    const input = Buffer.from('export class Foo {}');
    const result = sanitizePii(input, ctx);
    expect(result.equals(input)).toBe(true);
  });
});

describe('default-config', () => {
  it('replaces sensitive field values', () => {
    const input = Buffer.from(
      JSON.stringify({
        attributes: {
          apiKey: 'sk-abc123',
          secret: 'my-secret',
          token: 'tok-xyz',
          password: 'hunter2',
          title: 'Normal Title',
        },
      }),
    );

    const result = defaultConfig(input, ctx);
    const parsed = JSON.parse(result.toString());
    expect(parsed.attributes.apiKey).toBe('REPLACE_ME');
    expect(parsed.attributes.secret).toBe('REPLACE_ME');
    expect(parsed.attributes.token).toBe('REPLACE_ME');
    expect(parsed.attributes.password).toBe('REPLACE_ME');
    expect(parsed.attributes.title).toBe('Normal Title');
  });

  it('is case-insensitive for key matching', () => {
    const input = Buffer.from(
      JSON.stringify({
        attributes: { ApiKey: 'value', SECRET: 'value' },
      }),
    );

    const result = defaultConfig(input, ctx);
    const parsed = JSON.parse(result.toString());
    expect(parsed.attributes.ApiKey).toBe('REPLACE_ME');
    expect(parsed.attributes.SECRET).toBe('REPLACE_ME');
  });

  it('preserves non-sensitive fields', () => {
    const input = Buffer.from(
      JSON.stringify({
        attributes: { name: 'Widget', description: 'A widget' },
      }),
    );

    const result = defaultConfig(input, ctx);
    const parsed = JSON.parse(result.toString());
    expect(parsed.attributes.name).toBe('Widget');
    expect(parsed.attributes.description).toBe('A widget');
  });

  it('returns non-JSON content unchanged', () => {
    const input = Buffer.from('not json');
    const result = defaultConfig(input, ctx);
    expect(result.equals(input)).toBe(true);
  });
});

describe('strip-metadata', () => {
  it('removes known meta keys', () => {
    const input = Buffer.from(
      JSON.stringify({
        meta: {
          adoptsFrom: { module: '../card', name: 'Card' },
          realmInfo: { name: 'Test' },
          realmURL: 'https://example.com/',
          lastModified: 1234567890,
        },
        attributes: { title: 'Test' },
      }),
    );

    const result = stripMetadata(input, ctx);
    const parsed = JSON.parse(result.toString());
    expect(parsed.meta.adoptsFrom).toBeTruthy();
    expect(parsed.meta.realmInfo).toBeUndefined();
    expect(parsed.meta.realmURL).toBeUndefined();
    expect(parsed.meta.lastModified).toBeUndefined();
  });

  it('preserves meta.adoptsFrom', () => {
    const input = Buffer.from(
      JSON.stringify({
        meta: {
          adoptsFrom: { module: '../blog-post', name: 'BlogPost' },
          realmInfo: 'remove me',
        },
      }),
    );

    const result = stripMetadata(input, ctx);
    const parsed = JSON.parse(result.toString());
    expect(parsed.meta.adoptsFrom.module).toBe('../blog-post');
    expect(parsed.meta.adoptsFrom.name).toBe('BlogPost');
  });

  it('removes _-prefixed attribute keys', () => {
    const input = Buffer.from(
      JSON.stringify({
        meta: { adoptsFrom: { module: '../card', name: 'Card' } },
        attributes: {
          title: 'Test',
          _internal: 'hidden',
          _debug: { foo: 'bar' },
        },
      }),
    );

    const result = stripMetadata(input, ctx);
    const parsed = JSON.parse(result.toString());
    expect(parsed.attributes.title).toBe('Test');
    expect(parsed.attributes._internal).toBeUndefined();
    expect(parsed.attributes._debug).toBeUndefined();
  });

  it('handles missing meta/attributes gracefully', () => {
    const input = Buffer.from(JSON.stringify({ other: 'data' }));
    const result = stripMetadata(input, ctx);
    const parsed = JSON.parse(result.toString());
    expect(parsed.other).toBe('data');
  });

  it('returns non-JSON content unchanged', () => {
    const input = Buffer.from('not json');
    const result = stripMetadata(input, ctx);
    expect(result.equals(input)).toBe(true);
  });
});
