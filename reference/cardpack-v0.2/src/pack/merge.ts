import * as fs from 'fs';
import * as path from 'path';
import * as yauzl from 'yauzl';
import { Readable } from 'stream';
import {
  type ManifestCard,
  MANIFEST_FILENAME,
  parseManifest,
  computeSha256,
} from './manifest.js';
import { type RewriteRule, rewriteUrls } from './url-rewriter.js';
import { getContentType } from './content-type.js';

export type MergeStrategy = 'full' | 'instance-only' | 'definitions-only';
export type ConflictMode = 'overwrite' | 'skip';

export interface MergeOptions {
  archivePath: string;
  targetDir: string;
  strategy: MergeStrategy;
  onConflict: ConflictMode;
  rewriteRules?: RewriteRule[];
  dryRun?: boolean;
}

export interface MergeResult {
  created: string[];
  updated: string[];
  skipped: string[];
}

/**
 * Merge files from a .cardpack archive into a target directory.
 *
 * Strategy filtering:
 * - `full`: all files
 * - `instance-only`: only .json files
 * - `definitions-only`: only .gts files
 *
 * Conflict handling:
 * - `overwrite`: overwrite existing files (tracked in `updated`)
 * - `skip`: skip existing files (tracked in `skipped`)
 */
export async function mergeArchive(options: MergeOptions): Promise<MergeResult> {
  const { archivePath, targetDir, strategy, onConflict, rewriteRules, dryRun = false } = options;

  const created: string[] = [];
  const updated: string[] = [];
  const skipped: string[] = [];

  // Read manifest first to know which entries to skip
  const manifest = await readManifest(archivePath);
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

    // Apply strategy filter
    const ext = path.extname(fileName).toLowerCase();
    if (strategy === 'instance-only' && ext !== '.json') return;
    if (strategy === 'definitions-only' && ext !== '.gts') return;

    let content = await streamToBuffer(readStream);

    // Apply URL rewriting
    if (rewriteRules && rewriteRules.length > 0) {
      const result = rewriteUrls(content, fileName, rewriteRules);
      content = result.content;
    }

    const destPath = path.join(targetDir, fileName);
    const exists = fs.existsSync(destPath);

    if (exists) {
      // Check if content differs
      const existingContent = fs.readFileSync(destPath);
      const existingHash = computeSha256(existingContent);
      const newHash = computeSha256(content);

      if (existingHash === newHash) {
        skipped.push(fileName);
        return;
      }

      if (onConflict === 'skip') {
        skipped.push(fileName);
        return;
      }

      // overwrite
      if (!dryRun) {
        fs.writeFileSync(destPath, content);
      }
      updated.push(fileName);
    } else {
      if (!dryRun) {
        const destDir = path.dirname(destPath);
        if (!fs.existsSync(destDir)) {
          fs.mkdirSync(destDir, { recursive: true });
        }
        fs.writeFileSync(destPath, content);
      }
      created.push(fileName);
    }
  });

  return { created, updated, skipped };
}

// ---- INTERNAL HELPERS (duplicated from archive.ts to avoid circular deps) ----

async function readManifest(archivePath: string): Promise<ManifestCard> {
  const zipfile = await openZip(archivePath);
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
            try {
              const manifest = parseManifest(Buffer.concat(chunks).toString('utf-8'));
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

function openZip(archivePath: string): Promise<yauzl.ZipFile> {
  return new Promise((resolve, reject) => {
    yauzl.open(archivePath, { lazyEntries: true }, (err, zipfile) => {
      if (err) reject(err);
      else resolve(zipfile!);
    });
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
