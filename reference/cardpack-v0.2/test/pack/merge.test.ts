import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { createArchive } from '../../src/pack/archive.js';
import { mergeArchive } from '../../src/pack/merge.js';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'merge-test-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function createSourceWithTypes(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });

  // GTS definition
  fs.writeFileSync(
    path.join(dir, 'blog-post.gts'),
    `import { Base } from 'https://old.com/base';\nexport class BlogPost extends Base {}\n`,
  );

  // JSON instance
  const instanceDir = path.join(dir, 'BlogPost');
  fs.mkdirSync(instanceDir);
  fs.writeFileSync(
    path.join(instanceDir, 'welcome.json'),
    JSON.stringify({
      meta: { adoptsFrom: { module: 'https://old.com/blog-post', name: 'BlogPost' } },
      attributes: { title: 'Welcome', link: 'https://old.com/about' },
    }),
  );

  // Config file
  fs.writeFileSync(
    path.join(dir, '.realm.json'),
    JSON.stringify({ name: 'Test' }),
  );
}

async function createTestArchive(sourceDir: string): Promise<string> {
  const archivePath = path.join(tmpDir, 'test.cardpack');
  await createArchive({ sourceDir, outputPath: archivePath });
  return archivePath;
}

describe('mergeArchive', () => {
  it('creates all files when merging into empty directory', async () => {
    const sourceDir = path.join(tmpDir, 'source');
    createSourceWithTypes(sourceDir);
    const archivePath = await createTestArchive(sourceDir);

    const targetDir = path.join(tmpDir, 'target');
    fs.mkdirSync(targetDir, { recursive: true });

    const result = await mergeArchive({
      archivePath,
      targetDir,
      strategy: 'full',
      onConflict: 'skip',
    });

    expect(result.created.length).toBe(3); // blog-post.gts, BlogPost/welcome.json, .realm.json
    expect(result.updated.length).toBe(0);
    expect(result.skipped.length).toBe(0);

    expect(fs.existsSync(path.join(targetDir, 'blog-post.gts'))).toBe(true);
    expect(fs.existsSync(path.join(targetDir, 'BlogPost', 'welcome.json'))).toBe(true);
    expect(fs.existsSync(path.join(targetDir, '.realm.json'))).toBe(true);
  });

  it('skips identical files', async () => {
    const sourceDir = path.join(tmpDir, 'source');
    createSourceWithTypes(sourceDir);
    const archivePath = await createTestArchive(sourceDir);

    // Pre-populate target with identical content
    const targetDir = path.join(tmpDir, 'target');
    createSourceWithTypes(targetDir);

    const result = await mergeArchive({
      archivePath,
      targetDir,
      strategy: 'full',
      onConflict: 'skip',
    });

    expect(result.created.length).toBe(0);
    expect(result.updated.length).toBe(0);
    expect(result.skipped.length).toBe(3); // all identical
  });

  it('overwrites differing files when onConflict is overwrite', async () => {
    const sourceDir = path.join(tmpDir, 'source');
    createSourceWithTypes(sourceDir);
    const archivePath = await createTestArchive(sourceDir);

    const targetDir = path.join(tmpDir, 'target');
    fs.mkdirSync(targetDir, { recursive: true });
    fs.writeFileSync(path.join(targetDir, '.realm.json'), '{"name": "Old"}');

    const result = await mergeArchive({
      archivePath,
      targetDir,
      strategy: 'full',
      onConflict: 'overwrite',
    });

    expect(result.updated).toContain('.realm.json');
    const content = JSON.parse(fs.readFileSync(path.join(targetDir, '.realm.json'), 'utf-8'));
    expect(content.name).toBe('Test'); // overwritten with archive content
  });

  it('skips differing files when onConflict is skip', async () => {
    const sourceDir = path.join(tmpDir, 'source');
    createSourceWithTypes(sourceDir);
    const archivePath = await createTestArchive(sourceDir);

    const targetDir = path.join(tmpDir, 'target');
    fs.mkdirSync(targetDir, { recursive: true });
    fs.writeFileSync(path.join(targetDir, '.realm.json'), '{"name": "Old"}');

    const result = await mergeArchive({
      archivePath,
      targetDir,
      strategy: 'full',
      onConflict: 'skip',
    });

    expect(result.skipped).toContain('.realm.json');
    const content = JSON.parse(fs.readFileSync(path.join(targetDir, '.realm.json'), 'utf-8'));
    expect(content.name).toBe('Old'); // preserved
  });

  it('instance-only strategy only merges JSON files', async () => {
    const sourceDir = path.join(tmpDir, 'source');
    createSourceWithTypes(sourceDir);
    const archivePath = await createTestArchive(sourceDir);

    const targetDir = path.join(tmpDir, 'target');
    fs.mkdirSync(targetDir, { recursive: true });

    const result = await mergeArchive({
      archivePath,
      targetDir,
      strategy: 'instance-only',
      onConflict: 'overwrite',
    });

    const created = result.created;
    // Only JSON files
    expect(created).toContain('BlogPost/welcome.json');
    expect(created).toContain('.realm.json');
    expect(created).not.toContain('blog-post.gts');

    expect(fs.existsSync(path.join(targetDir, 'blog-post.gts'))).toBe(false);
    expect(fs.existsSync(path.join(targetDir, 'BlogPost', 'welcome.json'))).toBe(true);
  });

  it('definitions-only strategy only merges GTS files', async () => {
    const sourceDir = path.join(tmpDir, 'source');
    createSourceWithTypes(sourceDir);
    const archivePath = await createTestArchive(sourceDir);

    const targetDir = path.join(tmpDir, 'target');
    fs.mkdirSync(targetDir, { recursive: true });

    const result = await mergeArchive({
      archivePath,
      targetDir,
      strategy: 'definitions-only',
      onConflict: 'overwrite',
    });

    expect(result.created).toContain('blog-post.gts');
    expect(result.created).not.toContain('BlogPost/welcome.json');
    expect(result.created).not.toContain('.realm.json');

    expect(fs.existsSync(path.join(targetDir, 'blog-post.gts'))).toBe(true);
    expect(fs.existsSync(path.join(targetDir, 'BlogPost', 'welcome.json'))).toBe(false);
  });

  it('applies URL rewriting during merge', async () => {
    const sourceDir = path.join(tmpDir, 'source');
    createSourceWithTypes(sourceDir);
    const archivePath = await createTestArchive(sourceDir);

    const targetDir = path.join(tmpDir, 'target');
    fs.mkdirSync(targetDir, { recursive: true });

    await mergeArchive({
      archivePath,
      targetDir,
      strategy: 'full',
      onConflict: 'overwrite',
      rewriteRules: [{ from: 'https://old.com/', to: 'https://new.com/' }],
    });

    const json = JSON.parse(
      fs.readFileSync(path.join(targetDir, 'BlogPost', 'welcome.json'), 'utf-8'),
    );
    expect(json.meta.adoptsFrom.module).toBe('https://new.com/blog-post');
    expect(json.attributes.link).toBe('https://new.com/about');

    const gts = fs.readFileSync(path.join(targetDir, 'blog-post.gts'), 'utf-8');
    expect(gts).toContain('https://new.com/base');
  });

  it('dry-run does not write files', async () => {
    const sourceDir = path.join(tmpDir, 'source');
    createSourceWithTypes(sourceDir);
    const archivePath = await createTestArchive(sourceDir);

    const targetDir = path.join(tmpDir, 'target');
    fs.mkdirSync(targetDir, { recursive: true });

    const result = await mergeArchive({
      archivePath,
      targetDir,
      strategy: 'full',
      onConflict: 'overwrite',
      dryRun: true,
    });

    expect(result.created.length).toBe(3);
    // No files should actually be written
    expect(fs.readdirSync(targetDir).length).toBe(0);
  });

  it('skips exclude and reference entries', async () => {
    const sourceDir = path.join(tmpDir, 'source');
    createSourceWithTypes(sourceDir);

    // Create with exclude rule
    const archivePath = path.join(tmpDir, 'test.cardpack');
    await createArchive({
      sourceDir,
      outputPath: archivePath,
      transformRules: [{ pattern: '*.gts', rule: 'exclude' }],
    });

    const targetDir = path.join(tmpDir, 'target');
    fs.mkdirSync(targetDir, { recursive: true });

    const result = await mergeArchive({
      archivePath,
      targetDir,
      strategy: 'full',
      onConflict: 'overwrite',
    });

    // GTS was excluded, so it shouldn't be merged
    expect(result.created).not.toContain('blog-post.gts');
    expect(fs.existsSync(path.join(targetDir, 'blog-post.gts'))).toBe(false);
  });
});
