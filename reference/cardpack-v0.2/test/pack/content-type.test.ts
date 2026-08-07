import { describe, it, expect } from 'vitest';
import { getContentType, isTextFile } from '../../src/pack/content-type.js';

describe('getContentType', () => {
  it('returns correct type for .json files', () => {
    expect(getContentType('data.json')).toBe('application/json');
  });

  it('returns correct type for .gts files', () => {
    expect(getContentType('card.gts')).toBe('application/vnd.card+source');
  });

  it('returns correct type for image files', () => {
    expect(getContentType('photo.png')).toBe('image/png');
    expect(getContentType('photo.jpg')).toBe('image/jpeg');
    expect(getContentType('photo.jpeg')).toBe('image/jpeg');
    expect(getContentType('icon.gif')).toBe('image/gif');
    expect(getContentType('hero.webp')).toBe('image/webp');
    expect(getContentType('logo.svg')).toBe('image/svg+xml');
  });

  it('returns correct type for web files', () => {
    expect(getContentType('page.html')).toBe('text/html');
    expect(getContentType('style.css')).toBe('text/css');
    expect(getContentType('script.js')).toBe('application/javascript');
    expect(getContentType('module.ts')).toBe('application/typescript');
  });

  it('returns octet-stream for unknown extensions', () => {
    expect(getContentType('file.xyz')).toBe('application/octet-stream');
    expect(getContentType('data.bin')).toBe('application/octet-stream');
  });

  it('is case-insensitive for extensions', () => {
    expect(getContentType('IMAGE.PNG')).toBe('image/png');
    expect(getContentType('DATA.JSON')).toBe('application/json');
  });

  it('handles paths with directories', () => {
    expect(getContentType('some/dir/file.json')).toBe('application/json');
    expect(getContentType('deep/nested/path/image.png')).toBe('image/png');
  });
});

describe('isTextFile', () => {
  it('identifies text types as text', () => {
    expect(isTextFile('text/plain')).toBe(true);
    expect(isTextFile('text/html')).toBe(true);
    expect(isTextFile('text/css')).toBe(true);
    expect(isTextFile('text/markdown')).toBe(true);
  });

  it('identifies JSON as text', () => {
    expect(isTextFile('application/json')).toBe(true);
  });

  it('identifies GTS source as text', () => {
    expect(isTextFile('application/vnd.card+source')).toBe(true);
  });

  it('identifies SVG as text', () => {
    expect(isTextFile('image/svg+xml')).toBe(true);
  });

  it('identifies binary types as non-text', () => {
    expect(isTextFile('image/png')).toBe(false);
    expect(isTextFile('image/jpeg')).toBe(false);
    expect(isTextFile('application/octet-stream')).toBe(false);
    expect(isTextFile('application/pdf')).toBe(false);
    expect(isTextFile('font/woff2')).toBe(false);
  });
});
