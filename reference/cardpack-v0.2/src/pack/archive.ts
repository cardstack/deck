import yazl from 'yazl';
import * as yauzl from 'yauzl';
import * as fs from 'fs';
import * as path from 'path';
import { Readable } from 'stream';
import {
  type ManifestCard,
  type ManifestEntry,
  MANIFEST_FILENAME,
  serializeManifest,
  parseManifest,
  createManifest,
  computeSha256,
  validateManifestAgainstFiles,
} from './manifest.js';
import { getContentType, isTextFile } from './content-type.js';
import { walkDirectory } from './file-walker.js';
import { discoverDependencies } from './dependency-graph.js';
import { type TransformRuleSpec, matchTransformRule } from './transform-rules.js';
import { getTransform } from './transforms.js';
import { type RewriteRule, rewriteUrls } from './url-rewriter.js';

// ---- CREATE ----

export interface CreateOptions {
  sourceDir: string;
  outputPath: string;
  description?: string;
  sourceRealm?: string;
  createdBy?: string;
  /** When set, only pack the root card and its discovered dependencies */
  rootFile?: string;
  /** Transform rules to apply (first-match-wins) */
  transformRules?: TransformRuleSpec[];
}

export async function createArchive(options: CreateOptions): Promise<ManifestCard> {
  const { sourceDir, outputPath, description, sourceRealm, createdBy, rootFile, transformRules } =
    options;

  const walkedFiles = rootFile
    ? walkDependencies(sourceDir, rootFile)
    : walkDirectory(sourceDir);

  const entries: ManifestEntry[] = [];
  // Track which files and buffers to add to the zip (exclude/reference entries are omitted)
  const zipItems: Array<{ relativePath: string; absolutePath?: string; buffer?: Buffer; contentType: string }> = [];

  for (const f of walkedFiles) {
    const rule = transformRules
      ? matchTransformRule(f.relativePath, transformRules)
      : { pattern: '*', rule: 'copy' as const };

    if (rule.rule === 'exclude') {
      entries.push({
        path: f.relativePath,
        contentType: f.contentType,
        size: 0,
        hash: '',
        rule: 'exclude',
      });
    } else if (rule.rule === 'reference') {
      entries.push({
        path: f.relativePath,
        contentType: f.contentType,
        size: 0,
        hash: '',
        rule: 'reference',
        referenceUrl: rule.referenceUrl,
      });
    } else if (rule.rule === 'export') {
      const content = fs.readFileSync(f.absolutePath);
      const transformFn = getTransform(rule.transform!);
      const transformed = transformFn(content, {
        filePath: f.relativePath,
        contentType: f.contentType,
      });
      entries.push({
        path: f.relativePath,
        contentType: f.contentType,
        size: transformed.length,
        hash: computeSha256(transformed),
        rule: 'export',
        transform: rule.transform,
      });
      zipItems.push({
        relativePath: f.relativePath,
        buffer: transformed,
        contentType: f.contentType,
      });
    } else {
      // 'copy' — default behavior
      entries.push({
        path: f.relativePath,
        contentType: f.contentType,
        size: f.size,
        hash: f.hash,
        rule: 'copy',
      });
      zipItems.push({
        relativePath: f.relativePath,
        absolutePath: f.absolutePath,
        contentType: f.contentType,
      });
    }
  }

  const manifest = createManifest({ entries, sourceRealm, description, createdBy });
  const manifestJson = serializeManifest(manifest);

  const zipfile = new yazl.ZipFile();

  // manifest.json is always the first entry
  zipfile.addBuffer(Buffer.from(manifestJson, 'utf-8'), MANIFEST_FILENAME, {
    compress: true,
  });

  for (const item of zipItems) {
    if (item.buffer) {
      zipfile.addBuffer(item.buffer, item.relativePath, {
        compress: isTextFile(item.contentType),
      });
    } else {
      zipfile.addFile(item.absolutePath!, item.relativePath, {
        compress: isTextFile(item.contentType),
      });
    }
  }

  zipfile.end();

  const outputDir = path.dirname(path.resolve(outputPath));
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  await new Promise<void>((resolve, reject) => {
    const writeStream = fs.createWriteStream(outputPath);
    zipfile.outputStream.pipe(writeStream);
    writeStream.on('close', resolve);
    writeStream.on('error', reject);
  });

  return manifest;
}

// ---- EXTRACT ----

export interface ExtractOptions {
  archivePath: string;
  targetDir: string;
  validate?: boolean;
  /** URL rewrite rules to apply during extraction */
  rewriteRules?: RewriteRule[];
  /** How to handle conflicts with existing files */
  onConflict?: 'overwrite' | 'skip';
  /** Preview changes without writing files */
  dryRun?: boolean;
}

export interface ExtractResult {
  manifest: ManifestCard;
  extracted: string[];
  skipped: string[];
  conflicts: string[];
  rewriteCount: number;
}

export async function extractArchive(options: ExtractOptions): Promise<ExtractResult> {
  const {
    archivePath,
    targetDir,
    validate = true,
    rewriteRules,
    onConflict,
    dryRun = false,
  } = options;

  const manifest = await readManifestFromArchive(archivePath);
  const actualFiles = new Map<string, { size: number; hash: string }>();
  const extracted: string[] = [];
  const skipped: string[] = [];
  const conflicts: string[] = [];
  let rewriteCount = 0;

  // Build a set of entries to skip (exclude/reference have no file content)
  const skipEntries = new Set(
    manifest.attributes.entries
      .filter((e) => {
        const rule = e.rule || 'copy';
        return rule === 'exclude' || rule === 'reference';
      })
      .map((e) => e.path),
  );

  const zipfile = await openZip(archivePath);
  await forEachEntry(zipfile, async (entry, readStream) => {
    const fileName = entry.fileName;
    if (fileName === MANIFEST_FILENAME) return;
    if (skipEntries.has(fileName)) return;

    let content = await streamToBuffer(readStream);

    // Apply URL rewriting if configured
    if (rewriteRules && rewriteRules.length > 0) {
      const result = rewriteUrls(content, fileName, rewriteRules);
      content = result.content;
      rewriteCount += result.rewriteCount;
    }

    const destPath = path.join(targetDir, fileName);

    // Conflict handling
    if (onConflict && fs.existsSync(destPath)) {
      if (onConflict === 'skip') {
        skipped.push(fileName);
        actualFiles.set(fileName, {
          size: content.length,
          hash: computeSha256(content),
        });
        return;
      }
      // 'overwrite' falls through to write
      conflicts.push(fileName);
    }

    if (!dryRun) {
      const destDir = path.dirname(destPath);
      if (!fs.existsSync(destDir)) {
        fs.mkdirSync(destDir, { recursive: true });
      }
      fs.writeFileSync(destPath, content);
    }

    extracted.push(fileName);
    actualFiles.set(fileName, {
      size: content.length,
      hash: computeSha256(content),
    });
  });

  // Skip validation when URL rewriting was applied (content intentionally changed)
  const hasRewrites = rewriteRules && rewriteRules.length > 0;
  if (validate && !dryRun && !hasRewrites) {
    const result = validateManifestAgainstFiles(manifest, actualFiles);
    if (!result.valid) {
      console.warn('Warning: Archive integrity issues detected:');
      for (const err of result.errors) {
        console.warn(`  - ${err}`);
      }
    }
  }

  return { manifest, extracted, skipped, conflicts, rewriteCount };
}

// ---- LIST ----

export interface ListResult {
  manifest: ManifestCard;
  entries: ManifestEntry[];
}

export async function listArchive(archivePath: string): Promise<ListResult> {
  const manifest = await readManifestFromArchive(archivePath);

  return {
    manifest,
    entries: manifest.attributes.entries,
  };
}

// ---- ADD ----

export async function addToArchive(
  archivePath: string,
  filePath: string,
  archivePathOverride?: string,
): Promise<ManifestCard> {
  const existingManifest = await readManifestFromArchive(archivePath);
  const targetPath = archivePathOverride || path.basename(filePath);

  const content = fs.readFileSync(filePath);
  const contentType = getContentType(filePath);
  const hash = computeSha256(content);

  const newEntry: ManifestEntry = {
    path: targetPath,
    contentType,
    size: content.length,
    hash,
    rule: 'copy',
  };

  const updatedEntries = existingManifest.attributes.entries.filter(
    (e) => e.path !== targetPath,
  );
  updatedEntries.push(newEntry);

  const updatedManifest = createManifest({
    entries: updatedEntries,
    sourceRealm: existingManifest.attributes.sourceRealm,
    description: existingManifest.attributes.description,
    createdBy: existingManifest.attributes.createdBy,
  });

  const zipfile = new yazl.ZipFile();

  zipfile.addBuffer(
    Buffer.from(serializeManifest(updatedManifest), 'utf-8'),
    MANIFEST_FILENAME,
    { compress: true },
  );

  // Copy existing entries (except manifest and the file being replaced)
  const existingZip = await openZip(archivePath);
  await forEachEntry(existingZip, async (entry, readStream) => {
    if (entry.fileName === MANIFEST_FILENAME) return;
    if (entry.fileName === targetPath) return;

    const buf = await streamToBuffer(readStream);
    const existingContentType = getContentType(entry.fileName);
    zipfile.addBuffer(buf, entry.fileName, {
      compress: isTextFile(existingContentType),
    });
  });

  // Add the new file
  zipfile.addBuffer(content, targetPath, {
    compress: isTextFile(contentType),
  });

  zipfile.end();

  // Atomic write via temp file + rename
  const tmpPath = archivePath + '.tmp';
  await new Promise<void>((resolve, reject) => {
    const writeStream = fs.createWriteStream(tmpPath);
    zipfile.outputStream.pipe(writeStream);
    writeStream.on('close', resolve);
    writeStream.on('error', reject);
  });
  fs.renameSync(tmpPath, archivePath);

  return updatedManifest;
}

// ---- REMOVE ----

export async function removeFromArchive(
  archivePath: string,
  pathInside: string,
): Promise<ManifestCard> {
  const existingManifest = await readManifestFromArchive(archivePath);

  const entryExists = existingManifest.attributes.entries.some(
    (e) => e.path === pathInside,
  );
  if (!entryExists) {
    throw new Error(`File "${pathInside}" not found in archive`);
  }

  const updatedEntries = existingManifest.attributes.entries.filter(
    (e) => e.path !== pathInside,
  );

  const updatedManifest = createManifest({
    entries: updatedEntries,
    sourceRealm: existingManifest.attributes.sourceRealm,
    description: existingManifest.attributes.description,
    createdBy: existingManifest.attributes.createdBy,
  });

  const zipfile = new yazl.ZipFile();

  zipfile.addBuffer(
    Buffer.from(serializeManifest(updatedManifest), 'utf-8'),
    MANIFEST_FILENAME,
    { compress: true },
  );

  const existingZip = await openZip(archivePath);
  await forEachEntry(existingZip, async (entry, readStream) => {
    if (entry.fileName === MANIFEST_FILENAME) return;
    if (entry.fileName === pathInside) return;

    const buf = await streamToBuffer(readStream);
    const contentType = getContentType(entry.fileName);
    zipfile.addBuffer(buf, entry.fileName, {
      compress: isTextFile(contentType),
    });
  });

  zipfile.end();

  const tmpPath = archivePath + '.tmp';
  await new Promise<void>((resolve, reject) => {
    const writeStream = fs.createWriteStream(tmpPath);
    zipfile.outputStream.pipe(writeStream);
    writeStream.on('close', resolve);
    writeStream.on('error', reject);
  });
  fs.renameSync(tmpPath, archivePath);

  return updatedManifest;
}

// ---- DEPENDENCY-BASED WALKING ----

import type { WalkedFile } from './file-walker.js';

function walkDependencies(sourceDir: string, rootFile: string): WalkedFile[] {
  const resolvedRoot = path.resolve(sourceDir);
  const result = discoverDependencies(rootFile, resolvedRoot);

  return result.files.map((dep) => {
    const absolutePath = path.join(resolvedRoot, dep.relativePath);
    const content = fs.readFileSync(absolutePath);
    return {
      relativePath: dep.relativePath,
      absolutePath,
      size: content.length,
      hash: computeSha256(content),
      contentType: getContentType(dep.relativePath),
    };
  });
}

// ---- REWRITE IN-PLACE ----

export async function rewriteArchive(
  archivePath: string,
  rules: RewriteRule[],
): Promise<{ rewriteCount: number }> {
  const existingManifest = await readManifestFromArchive(archivePath);
  const updatedEntries = [...existingManifest.attributes.entries];

  const newZip = new yazl.ZipFile();
  let totalRewrites = 0;

  const zipfile = await openZip(archivePath);
  await forEachEntry(zipfile, async (entry, readStream) => {
    const fileName = entry.fileName;
    if (fileName === MANIFEST_FILENAME) return;

    let content = await streamToBuffer(readStream);

    const result = rewriteUrls(content, fileName, rules);
    content = result.content;
    totalRewrites += result.rewriteCount;

    // Update manifest entry if content changed
    if (result.rewriteCount > 0) {
      const entryIdx = updatedEntries.findIndex((e) => e.path === fileName);
      if (entryIdx >= 0) {
        updatedEntries[entryIdx] = {
          ...updatedEntries[entryIdx],
          size: content.length,
          hash: computeSha256(content),
        };
      }
    }

    const contentType = getContentType(fileName);
    newZip.addBuffer(content, fileName, {
      compress: isTextFile(contentType),
    });
  });

  // Rebuild manifest
  const newManifest = createManifest({
    entries: updatedEntries,
    sourceRealm: existingManifest.attributes.sourceRealm,
    description: existingManifest.attributes.description,
    createdBy: existingManifest.attributes.createdBy,
  });

  newZip.addBuffer(
    Buffer.from(serializeManifest(newManifest), 'utf-8'),
    MANIFEST_FILENAME,
    { compress: true },
  );

  newZip.end();

  // Atomic write via temp file + rename
  const tmpPath = archivePath + '.tmp';
  await new Promise<void>((resolve, reject) => {
    const writeStream = fs.createWriteStream(tmpPath);
    newZip.outputStream.pipe(writeStream);
    writeStream.on('close', resolve);
    writeStream.on('error', reject);
  });
  fs.renameSync(tmpPath, archivePath);

  return { rewriteCount: totalRewrites };
}

// ---- INTERNAL HELPERS ----

async function readManifestFromArchive(archivePath: string): Promise<ManifestCard> {
  const zipfile = await openZip(archivePath);
  return readManifestFromZip(zipfile);
}

function openZip(archivePath: string): Promise<yauzl.ZipFile> {
  return new Promise((resolve, reject) => {
    yauzl.open(archivePath, { lazyEntries: true }, (err, zipfile) => {
      if (err) reject(err);
      else resolve(zipfile!);
    });
  });
}

function readManifestFromZip(zipfile: yauzl.ZipFile): Promise<ManifestCard> {
  return new Promise((resolve, reject) => {
    let found = false;
    zipfile.readEntry();
    zipfile.on('entry', (entry: yauzl.Entry) => {
      if (entry.fileName === MANIFEST_FILENAME) {
        found = true;
        zipfile.openReadStream(entry, (err, readStream) => {
          if (err) return reject(err);
          const chunks: Buffer[] = [];
          readStream!.on('data', (chunk: Buffer) => chunks.push(chunk));
          readStream!.on('end', () => {
            const json = Buffer.concat(chunks).toString('utf-8');
            try {
              const manifest = parseManifest(json);
              zipfile.close();
              resolve(manifest);
            } catch (e) {
              reject(e);
            }
          });
          readStream!.on('error', reject);
        });
      } else {
        zipfile.readEntry();
      }
    });
    zipfile.on('end', () => {
      if (!found) reject(new Error('No manifest.json found in archive'));
    });
    zipfile.on('error', reject);
  });
}

function forEachEntry(
  zipfile: yauzl.ZipFile,
  handler: (entry: yauzl.Entry, readStream: Readable) => Promise<void>,
): Promise<void> {
  return new Promise((resolve, reject) => {
    zipfile.readEntry();
    zipfile.on('entry', (entry: yauzl.Entry) => {
      if (entry.fileName.endsWith('/')) {
        // Directory entry, skip
        zipfile.readEntry();
        return;
      }
      zipfile.openReadStream(entry, async (err, readStream) => {
        if (err) return reject(err);
        try {
          await handler(entry, readStream!);
          zipfile.readEntry();
        } catch (e) {
          reject(e);
        }
      });
    });
    zipfile.on('end', resolve);
    zipfile.on('error', reject);
  });
}

function streamToBuffer(stream: Readable): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    stream.on('data', (chunk: Buffer) => chunks.push(chunk));
    stream.on('end', () => resolve(Buffer.concat(chunks)));
    stream.on('error', reject);
  });
}
