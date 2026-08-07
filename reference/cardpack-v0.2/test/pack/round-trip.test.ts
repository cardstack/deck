import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  createArchive,
  extractArchive,
  listArchive,
  addToArchive,
  removeFromArchive,
  rewriteArchive,
} from '../../src/pack/archive.js';
import { MANIFEST_FILENAME } from '../../src/pack/manifest.js';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cardpack-test-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function createTestWorkspace(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });

  // A card definition
  fs.writeFileSync(
    path.join(dir, 'blog-post.gts'),
    `export class BlogPost extends CardDef {\n  @field title = contains(StringField);\n}\n`,
  );

  // A card instance in a subdirectory
  const instanceDir = path.join(dir, 'BlogPost');
  fs.mkdirSync(instanceDir, { recursive: true });
  fs.writeFileSync(
    path.join(instanceDir, 'welcome.json'),
    JSON.stringify(
      {
        meta: { adoptsFrom: { module: '../blog-post', name: 'BlogPost' } },
        attributes: { title: 'Welcome' },
      },
      null,
      2,
    ),
  );

  // A realm config
  fs.writeFileSync(
    path.join(dir, '.realm.json'),
    JSON.stringify({ name: 'Test Workspace' }, null, 2),
  );
}

function createBinaryFile(filePath: string): void {
  // Minimal valid PNG (1x1 pixel, transparent)
  const pngHeader = Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, // PNG signature
    0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52, // IHDR chunk
    0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, // 1x1
    0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, // RGBA
    0x89, 0x00, 0x00, 0x00, 0x0a, 0x49, 0x44, 0x41, // IDAT
    0x54, 0x78, 0x9c, 0x62, 0x00, 0x00, 0x00, 0x02,
    0x00, 0x01, 0xe5, 0x27, 0xde, 0xfc, 0x00, 0x00,
    0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42,
    0x60, 0x82, // IEND
  ]);
  fs.writeFileSync(filePath, pngHeader);
}

describe('round-trip: create → extract', () => {
  it('packs and unpacks a workspace with identical content', async () => {
    const sourceDir = path.join(tmpDir, 'source');
    createTestWorkspace(sourceDir);

    const archivePath = path.join(tmpDir, 'test.cardpack');
    const targetDir = path.join(tmpDir, 'restored');

    await createArchive({ sourceDir, outputPath: archivePath });
    await extractArchive({ archivePath, targetDir });

    // Compare files
    const sourceGts = fs.readFileSync(path.join(sourceDir, 'blog-post.gts'), 'utf-8');
    const restoredGts = fs.readFileSync(path.join(targetDir, 'blog-post.gts'), 'utf-8');
    expect(restoredGts).toBe(sourceGts);

    const sourceJson = fs.readFileSync(path.join(sourceDir, 'BlogPost', 'welcome.json'), 'utf-8');
    const restoredJson = fs.readFileSync(path.join(targetDir, 'BlogPost', 'welcome.json'), 'utf-8');
    expect(restoredJson).toBe(sourceJson);

    const sourceRealm = fs.readFileSync(path.join(sourceDir, '.realm.json'), 'utf-8');
    const restoredRealm = fs.readFileSync(path.join(targetDir, '.realm.json'), 'utf-8');
    expect(restoredRealm).toBe(sourceRealm);
  });

  it('preserves nested directory structure', async () => {
    const sourceDir = path.join(tmpDir, 'source');
    createTestWorkspace(sourceDir);

    // Add deeper nesting
    const deepDir = path.join(sourceDir, 'deep', 'nested', 'dir');
    fs.mkdirSync(deepDir, { recursive: true });
    fs.writeFileSync(path.join(deepDir, 'data.json'), '{"deep": true}');

    const archivePath = path.join(tmpDir, 'nested.cardpack');
    const targetDir = path.join(tmpDir, 'restored');

    await createArchive({ sourceDir, outputPath: archivePath });
    await extractArchive({ archivePath, targetDir });

    const content = fs.readFileSync(path.join(targetDir, 'deep', 'nested', 'dir', 'data.json'), 'utf-8');
    expect(content).toBe('{"deep": true}');
  });

  it('handles binary files without corruption', async () => {
    const sourceDir = path.join(tmpDir, 'source');
    fs.mkdirSync(sourceDir, { recursive: true });

    const imagesDir = path.join(sourceDir, 'images');
    fs.mkdirSync(imagesDir);
    createBinaryFile(path.join(imagesDir, 'icon.png'));

    const archivePath = path.join(tmpDir, 'binary.cardpack');
    const targetDir = path.join(tmpDir, 'restored');

    await createArchive({ sourceDir, outputPath: archivePath });
    await extractArchive({ archivePath, targetDir });

    const original = fs.readFileSync(path.join(sourceDir, 'images', 'icon.png'));
    const restored = fs.readFileSync(path.join(targetDir, 'images', 'icon.png'));
    expect(restored.equals(original)).toBe(true);
  });

  it('excludes .boxel-history directory', async () => {
    const sourceDir = path.join(tmpDir, 'source');
    createTestWorkspace(sourceDir);

    // Add .boxel-history (should be excluded)
    const historyDir = path.join(sourceDir, '.boxel-history');
    fs.mkdirSync(historyDir, { recursive: true });
    fs.writeFileSync(path.join(historyDir, 'data.txt'), 'history data');

    const archivePath = path.join(tmpDir, 'exclude.cardpack');
    const { entries } = await listArchive(
      (await createArchive({ sourceDir, outputPath: archivePath }), archivePath),
    );

    const paths = entries.map((e) => e.path);
    expect(paths).not.toContain('.boxel-history/data.txt');
  });

  it('excludes .boxel-sync.json', async () => {
    const sourceDir = path.join(tmpDir, 'source');
    createTestWorkspace(sourceDir);

    fs.writeFileSync(
      path.join(sourceDir, '.boxel-sync.json'),
      JSON.stringify({ workspaceUrl: 'https://example.com' }),
    );

    const archivePath = path.join(tmpDir, 'exclude.cardpack');
    await createArchive({ sourceDir, outputPath: archivePath });
    const { entries } = await listArchive(archivePath);

    const paths = entries.map((e) => e.path);
    expect(paths).not.toContain('.boxel-sync.json');
  });

  it('excludes .DS_Store files', async () => {
    const sourceDir = path.join(tmpDir, 'source');
    createTestWorkspace(sourceDir);

    fs.writeFileSync(path.join(sourceDir, '.DS_Store'), 'mac metadata');

    const archivePath = path.join(tmpDir, 'exclude.cardpack');
    await createArchive({ sourceDir, outputPath: archivePath });
    const { entries } = await listArchive(archivePath);

    const paths = entries.map((e) => e.path);
    expect(paths).not.toContain('.DS_Store');
  });

  it('includes .realm.json despite being a dotfile', async () => {
    const sourceDir = path.join(tmpDir, 'source');
    createTestWorkspace(sourceDir);

    const archivePath = path.join(tmpDir, 'realm.cardpack');
    await createArchive({ sourceDir, outputPath: archivePath });
    const { entries } = await listArchive(archivePath);

    const paths = entries.map((e) => e.path);
    expect(paths).toContain('.realm.json');
  });
});

describe('list', () => {
  it('returns manifest and all entries', async () => {
    const sourceDir = path.join(tmpDir, 'source');
    createTestWorkspace(sourceDir);

    const archivePath = path.join(tmpDir, 'list.cardpack');
    await createArchive({ sourceDir, outputPath: archivePath });
    const { manifest, entries } = await listArchive(archivePath);

    expect(manifest.attributes.version).toBeTruthy();
    expect(entries.length).toBe(3); // blog-post.gts, BlogPost/welcome.json, .realm.json

    const paths = entries.map((e) => e.path).sort();
    expect(paths).toEqual(['.realm.json', 'BlogPost/welcome.json', 'blog-post.gts']);
  });

  it('entries have correct content types', async () => {
    const sourceDir = path.join(tmpDir, 'source');
    createTestWorkspace(sourceDir);

    const archivePath = path.join(tmpDir, 'types.cardpack');
    await createArchive({ sourceDir, outputPath: archivePath });
    const { entries } = await listArchive(archivePath);

    const gtsEntry = entries.find((e) => e.path === 'blog-post.gts');
    expect(gtsEntry?.contentType).toBe('application/vnd.card+source');

    const jsonEntry = entries.find((e) => e.path === 'BlogPost/welcome.json');
    expect(jsonEntry?.contentType).toBe('application/json');
  });
});

describe('add', () => {
  it('adds a new file to an existing archive', async () => {
    const sourceDir = path.join(tmpDir, 'source');
    createTestWorkspace(sourceDir);

    const archivePath = path.join(tmpDir, 'add.cardpack');
    await createArchive({ sourceDir, outputPath: archivePath });

    // Create a file to add
    const newFile = path.join(tmpDir, 'extra.json');
    fs.writeFileSync(newFile, '{"extra": true}');

    await addToArchive(archivePath, newFile);

    const { entries } = await listArchive(archivePath);
    const paths = entries.map((e) => e.path);
    expect(paths).toContain('extra.json');

    // Verify content by extracting
    const targetDir = path.join(tmpDir, 'extracted');
    await extractArchive({ archivePath, targetDir });
    const content = fs.readFileSync(path.join(targetDir, 'extra.json'), 'utf-8');
    expect(content).toBe('{"extra": true}');
  });

  it('replaces a file with the same name', async () => {
    const sourceDir = path.join(tmpDir, 'source');
    createTestWorkspace(sourceDir);

    const archivePath = path.join(tmpDir, 'replace.cardpack');
    await createArchive({ sourceDir, outputPath: archivePath });

    const { entries: before } = await listArchive(archivePath);
    const countBefore = before.length;

    // Create a replacement file
    const replacement = path.join(tmpDir, 'blog-post.gts');
    fs.writeFileSync(replacement, 'export class Updated {}');

    await addToArchive(archivePath, replacement);

    const { entries: after } = await listArchive(archivePath);
    // Count should be the same (replaced, not added)
    expect(after.length).toBe(countBefore);

    // Verify content
    const targetDir = path.join(tmpDir, 'extracted');
    await extractArchive({ archivePath, targetDir });
    const content = fs.readFileSync(path.join(targetDir, 'blog-post.gts'), 'utf-8');
    expect(content).toBe('export class Updated {}');
  });
});

describe('remove', () => {
  it('removes a file from an archive', async () => {
    const sourceDir = path.join(tmpDir, 'source');
    createTestWorkspace(sourceDir);

    const archivePath = path.join(tmpDir, 'remove.cardpack');
    await createArchive({ sourceDir, outputPath: archivePath });

    await removeFromArchive(archivePath, 'blog-post.gts');

    const { entries } = await listArchive(archivePath);
    const paths = entries.map((e) => e.path);
    expect(paths).not.toContain('blog-post.gts');
    expect(paths).toContain('BlogPost/welcome.json'); // other files untouched
  });

  it('throws when removing a non-existent file', async () => {
    const sourceDir = path.join(tmpDir, 'source');
    createTestWorkspace(sourceDir);

    const archivePath = path.join(tmpDir, 'remove-err.cardpack');
    await createArchive({ sourceDir, outputPath: archivePath });

    await expect(
      removeFromArchive(archivePath, 'does-not-exist.json'),
    ).rejects.toThrow('not found in archive');
  });
});

describe('manifest metadata', () => {
  it('records sourceRealm from options', async () => {
    const sourceDir = path.join(tmpDir, 'source');
    createTestWorkspace(sourceDir);

    const archivePath = path.join(tmpDir, 'meta.cardpack');
    await createArchive({
      sourceDir,
      outputPath: archivePath,
      sourceRealm: 'https://app.boxel.ai/user/workspace',
      createdBy: '@user:boxel.ai',
      description: 'Test workspace',
    });

    const { manifest } = await listArchive(archivePath);
    expect(manifest.attributes.sourceRealm).toBe('https://app.boxel.ai/user/workspace');
    expect(manifest.attributes.createdBy).toBe('@user:boxel.ai');
    expect(manifest.attributes.description).toBe('Test workspace');
  });

  it('has sha256 hashes for all entries', async () => {
    const sourceDir = path.join(tmpDir, 'source');
    createTestWorkspace(sourceDir);

    const archivePath = path.join(tmpDir, 'hashes.cardpack');
    await createArchive({ sourceDir, outputPath: archivePath });

    const { entries } = await listArchive(archivePath);
    for (const entry of entries) {
      expect(entry.hash).toMatch(/^[a-f0-9]{64}$/);
    }
  });

  it('has correct sizes for all entries', async () => {
    const sourceDir = path.join(tmpDir, 'source');
    createTestWorkspace(sourceDir);

    const archivePath = path.join(tmpDir, 'sizes.cardpack');
    await createArchive({ sourceDir, outputPath: archivePath });

    const { entries } = await listArchive(archivePath);
    for (const entry of entries) {
      expect(entry.size).toBeGreaterThan(0);
    }
  });
});

describe('transform rules in create', () => {
  it('excludes files matching exclude rule', async () => {
    const sourceDir = path.join(tmpDir, 'source');
    createTestWorkspace(sourceDir);

    // Add a Draft directory
    const draftDir = path.join(sourceDir, 'Draft');
    fs.mkdirSync(draftDir);
    fs.writeFileSync(path.join(draftDir, 'wip.json'), '{"draft": true}');

    const archivePath = path.join(tmpDir, 'exclude.cardpack');
    await createArchive({
      sourceDir,
      outputPath: archivePath,
      transformRules: [{ pattern: 'Draft/*', rule: 'exclude' }],
    });

    const { entries } = await listArchive(archivePath);
    const draftEntry = entries.find((e) => e.path === 'Draft/wip.json');
    expect(draftEntry).toBeDefined();
    expect(draftEntry!.rule).toBe('exclude');
    expect(draftEntry!.size).toBe(0);
    expect(draftEntry!.hash).toBe('');

    // Excluded files should NOT be in the zip content
    const targetDir = path.join(tmpDir, 'restored');
    await extractArchive({ archivePath, targetDir });
    expect(fs.existsSync(path.join(targetDir, 'Draft', 'wip.json'))).toBe(false);
  });

  it('marks files as reference with URL', async () => {
    const sourceDir = path.join(tmpDir, 'source');
    createTestWorkspace(sourceDir);

    const archivePath = path.join(tmpDir, 'ref.cardpack');
    await createArchive({
      sourceDir,
      outputPath: archivePath,
      transformRules: [
        { pattern: '*.gts', rule: 'reference', referenceUrl: 'https://catalog.boxel.ai/' },
      ],
    });

    const { entries } = await listArchive(archivePath);
    const gtsEntry = entries.find((e) => e.path === 'blog-post.gts');
    expect(gtsEntry).toBeDefined();
    expect(gtsEntry!.rule).toBe('reference');
    expect(gtsEntry!.referenceUrl).toBe('https://catalog.boxel.ai/');
    expect(gtsEntry!.size).toBe(0);

    // Reference files should NOT be in the zip content
    const targetDir = path.join(tmpDir, 'restored');
    await extractArchive({ archivePath, targetDir });
    expect(fs.existsSync(path.join(targetDir, 'blog-post.gts'))).toBe(false);
    // But copied files should be there
    expect(fs.existsSync(path.join(targetDir, 'BlogPost', 'welcome.json'))).toBe(true);
  });

  it('applies export transform to matching files', async () => {
    const sourceDir = path.join(tmpDir, 'source');
    fs.mkdirSync(sourceDir, { recursive: true });

    // Create a JSON instance with PII
    const authorDir = path.join(sourceDir, 'Author');
    fs.mkdirSync(authorDir);
    fs.writeFileSync(
      path.join(authorDir, 'jane.json'),
      JSON.stringify({
        meta: { adoptsFrom: { module: '../author', name: 'Author' } },
        attributes: { name: 'Jane', email: 'jane@example.com', phone: '555-123-4567' },
      }),
    );

    const archivePath = path.join(tmpDir, 'export.cardpack');
    await createArchive({
      sourceDir,
      outputPath: archivePath,
      transformRules: [{ pattern: 'Author/*', rule: 'export', transform: 'sanitize-pii' }],
    });

    const { entries } = await listArchive(archivePath);
    const authorEntry = entries.find((e) => e.path === 'Author/jane.json');
    expect(authorEntry).toBeDefined();
    expect(authorEntry!.rule).toBe('export');
    expect(authorEntry!.transform).toBe('sanitize-pii');

    // Extract and verify content was transformed
    const targetDir = path.join(tmpDir, 'restored');
    await extractArchive({ archivePath, targetDir });
    const content = JSON.parse(
      fs.readFileSync(path.join(targetDir, 'Author', 'jane.json'), 'utf-8'),
    );
    expect(content.attributes.email).toBe('<email>');
    expect(content.attributes.phone).toBe('<phone>');
    expect(content.attributes.name).toBe('Jane'); // non-PII preserved
  });

  it('creates backward-compatible archive with no rules', async () => {
    const sourceDir = path.join(tmpDir, 'source');
    createTestWorkspace(sourceDir);

    const archivePath = path.join(tmpDir, 'compat.cardpack');
    await createArchive({ sourceDir, outputPath: archivePath });

    const { entries } = await listArchive(archivePath);
    for (const entry of entries) {
      expect(entry.rule).toBe('copy');
    }
  });
});

describe('extract with rewrite and conflict', () => {
  it('rewrites URLs during extraction', async () => {
    const sourceDir = path.join(tmpDir, 'source');
    fs.mkdirSync(sourceDir, { recursive: true });

    fs.writeFileSync(
      path.join(sourceDir, 'card.json'),
      JSON.stringify({
        meta: { adoptsFrom: { module: 'https://old-realm.boxel.ai/blog-post', name: 'BlogPost' } },
        attributes: { link: 'https://old-realm.boxel.ai/some/resource' },
      }),
    );

    const archivePath = path.join(tmpDir, 'rewrite.cardpack');
    await createArchive({ sourceDir, outputPath: archivePath });

    const targetDir = path.join(tmpDir, 'restored');
    const result = await extractArchive({
      archivePath,
      targetDir,
      rewriteRules: [{ from: 'https://old-realm.boxel.ai/', to: 'https://new-realm.boxel.ai/' }],
    });

    expect(result.rewriteCount).toBe(2);
    const content = JSON.parse(fs.readFileSync(path.join(targetDir, 'card.json'), 'utf-8'));
    expect(content.meta.adoptsFrom.module).toBe('https://new-realm.boxel.ai/blog-post');
    expect(content.attributes.link).toBe('https://new-realm.boxel.ai/some/resource');
  });

  it('skips existing files when onConflict is skip', async () => {
    const sourceDir = path.join(tmpDir, 'source');
    fs.mkdirSync(sourceDir, { recursive: true });
    fs.writeFileSync(path.join(sourceDir, 'data.json'), '{"version": 2}');

    const archivePath = path.join(tmpDir, 'conflict.cardpack');
    await createArchive({ sourceDir, outputPath: archivePath });

    // Pre-create target with existing content
    const targetDir = path.join(tmpDir, 'target');
    fs.mkdirSync(targetDir, { recursive: true });
    fs.writeFileSync(path.join(targetDir, 'data.json'), '{"version": 1}');

    const result = await extractArchive({
      archivePath,
      targetDir,
      onConflict: 'skip',
    });

    expect(result.skipped).toContain('data.json');
    expect(result.extracted).not.toContain('data.json');
    // Original content preserved
    const content = fs.readFileSync(path.join(targetDir, 'data.json'), 'utf-8');
    expect(content).toBe('{"version": 1}');
  });

  it('overwrites existing files when onConflict is overwrite', async () => {
    const sourceDir = path.join(tmpDir, 'source');
    fs.mkdirSync(sourceDir, { recursive: true });
    fs.writeFileSync(path.join(sourceDir, 'data.json'), '{"version": 2}');

    const archivePath = path.join(tmpDir, 'conflict.cardpack');
    await createArchive({ sourceDir, outputPath: archivePath });

    const targetDir = path.join(tmpDir, 'target');
    fs.mkdirSync(targetDir, { recursive: true });
    fs.writeFileSync(path.join(targetDir, 'data.json'), '{"version": 1}');

    const result = await extractArchive({
      archivePath,
      targetDir,
      onConflict: 'overwrite',
    });

    expect(result.conflicts).toContain('data.json');
    expect(result.extracted).toContain('data.json');
    const content = fs.readFileSync(path.join(targetDir, 'data.json'), 'utf-8');
    expect(content).toBe('{"version": 2}');
  });

  it('dry-run does not write files', async () => {
    const sourceDir = path.join(tmpDir, 'source');
    createTestWorkspace(sourceDir);

    const archivePath = path.join(tmpDir, 'dryrun.cardpack');
    await createArchive({ sourceDir, outputPath: archivePath });

    const targetDir = path.join(tmpDir, 'dryrun-target');
    fs.mkdirSync(targetDir, { recursive: true });

    const result = await extractArchive({
      archivePath,
      targetDir,
      dryRun: true,
    });

    expect(result.extracted.length).toBeGreaterThan(0);
    // No files should actually exist
    expect(fs.readdirSync(targetDir).length).toBe(0);
  });
});

describe('rewrite archive in-place', () => {
  it('rewrites URLs inside an archive', async () => {
    const sourceDir = path.join(tmpDir, 'source');
    fs.mkdirSync(sourceDir, { recursive: true });

    fs.writeFileSync(
      path.join(sourceDir, 'card.json'),
      JSON.stringify({
        meta: { adoptsFrom: { module: 'https://old.com/card-def', name: 'Card' } },
        attributes: { ref: 'https://old.com/other' },
      }),
    );
    fs.writeFileSync(
      path.join(sourceDir, 'def.gts'),
      `import { Base } from 'https://old.com/base';`,
    );

    const archivePath = path.join(tmpDir, 'rewrite.cardpack');
    await createArchive({ sourceDir, outputPath: archivePath });

    const result = await rewriteArchive(archivePath, [
      { from: 'https://old.com/', to: 'https://new.com/' },
    ]);

    expect(result.rewriteCount).toBe(3); // 2 in JSON + 1 in GTS

    // Verify by extracting
    const targetDir = path.join(tmpDir, 'verified');
    await extractArchive({ archivePath, targetDir });

    const json = JSON.parse(fs.readFileSync(path.join(targetDir, 'card.json'), 'utf-8'));
    expect(json.meta.adoptsFrom.module).toBe('https://new.com/card-def');
    expect(json.attributes.ref).toBe('https://new.com/other');

    const gts = fs.readFileSync(path.join(targetDir, 'def.gts'), 'utf-8');
    expect(gts).toContain('https://new.com/base');
  });

  it('updates manifest hashes after rewrite', async () => {
    const sourceDir = path.join(tmpDir, 'source');
    fs.mkdirSync(sourceDir, { recursive: true });
    fs.writeFileSync(
      path.join(sourceDir, 'card.json'),
      JSON.stringify({ attributes: { url: 'https://old.com/x' } }),
    );

    const archivePath = path.join(tmpDir, 'hash.cardpack');
    await createArchive({ sourceDir, outputPath: archivePath });

    const { entries: before } = await listArchive(archivePath);
    const hashBefore = before.find((e) => e.path === 'card.json')!.hash;

    await rewriteArchive(archivePath, [
      { from: 'https://old.com/', to: 'https://new.com/' },
    ]);

    const { entries: after } = await listArchive(archivePath);
    const hashAfter = after.find((e) => e.path === 'card.json')!.hash;

    expect(hashAfter).not.toBe(hashBefore);
    expect(hashAfter).toMatch(/^[a-f0-9]{64}$/);
  });
});
