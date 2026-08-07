import * as fs from 'fs';
import * as path from 'path';
import { getContentType } from './content-type.js';
import { computeSha256 } from './manifest.js';

export interface WalkedFile {
  relativePath: string;
  absolutePath: string;
  size: number;
  hash: string;
  contentType: string;
}

const ALWAYS_SKIP = new Set([
  '.boxel-history',
  '.boxel-sync.json',
  '.DS_Store',
  '.git',
  '.boxel-workspaces.json',
]);

export function walkDirectory(rootDir: string): WalkedFile[] {
  const files: WalkedFile[] = [];
  const resolvedRoot = path.resolve(rootDir);

  function scan(currentDir: string, prefix: string): void {
    const entries = fs.readdirSync(currentDir, { withFileTypes: true });

    for (const entry of entries) {
      if (ALWAYS_SKIP.has(entry.name)) continue;

      // Skip dotfiles except .realm.json
      if (entry.name.startsWith('.') && entry.name !== '.realm.json') {
        continue;
      }

      const absolutePath = path.join(currentDir, entry.name);
      const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;

      if (entry.isDirectory()) {
        scan(absolutePath, relativePath);
      } else if (entry.isFile()) {
        const content = fs.readFileSync(absolutePath);
        files.push({
          relativePath,
          absolutePath,
          size: content.length,
          hash: computeSha256(content),
          contentType: getContentType(entry.name),
        });
      }
    }
  }

  scan(resolvedRoot, '');
  return files;
}
