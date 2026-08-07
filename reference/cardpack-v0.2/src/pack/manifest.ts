import * as crypto from 'crypto';

export type ManifestRule = 'copy' | 'reference' | 'exclude' | 'export';

export interface ManifestEntry {
  path: string;
  contentType: string;
  size: number;
  hash: string;
  rule: ManifestRule;
  /** URL for the external reference (required when rule === 'reference') */
  referenceUrl?: string;
  /** Name of the built-in transform applied (required when rule === 'export') */
  transform?: string;
  /** Source realm URL for provenance tracking */
  sourceRealm?: string;
}

export interface ManifestCard {
  meta: {
    adoptsFrom: { module: '@cardstack/cardpack'; name: 'Manifest' };
  };
  attributes: {
    version: string;
    createdAt: string;
    createdBy: string;
    sourceRealm: string;
    description?: string;
    entries: ManifestEntry[];
  };
}

export const MANIFEST_FILENAME = 'manifest.json';
export const CARDPACK_FORMAT_VERSION = '0.2.0';

export function computeSha256(content: Buffer): string {
  return crypto.createHash('sha256').update(content).digest('hex');
}

export interface CreateManifestOptions {
  entries: ManifestEntry[];
  sourceRealm?: string;
  description?: string;
  createdBy?: string;
}

export function createManifest(options: CreateManifestOptions): ManifestCard {
  return {
    meta: {
      adoptsFrom: { module: '@cardstack/cardpack', name: 'Manifest' },
    },
    attributes: {
      version: CARDPACK_FORMAT_VERSION,
      createdAt: new Date().toISOString(),
      createdBy: options.createdBy || 'unknown',
      sourceRealm: options.sourceRealm || 'local',
      description: options.description,
      entries: options.entries,
    },
  };
}

export function serializeManifest(manifest: ManifestCard): string {
  return JSON.stringify(manifest, null, 2);
}

export function parseManifest(json: string): ManifestCard {
  const parsed = JSON.parse(json);
  validateManifestStructure(parsed);
  return parsed as ManifestCard;
}

export function validateManifestStructure(obj: unknown): void {
  if (!obj || typeof obj !== 'object') {
    throw new Error('Manifest must be a JSON object');
  }
  const manifest = obj as Record<string, unknown>;

  if (!manifest.meta || typeof manifest.meta !== 'object') {
    throw new Error('Manifest missing "meta" field');
  }
  const meta = manifest.meta as Record<string, unknown>;
  if (!meta.adoptsFrom || typeof meta.adoptsFrom !== 'object') {
    throw new Error('Manifest missing "meta.adoptsFrom" field');
  }

  if (!manifest.attributes || typeof manifest.attributes !== 'object') {
    throw new Error('Manifest missing "attributes" field');
  }
  const attrs = manifest.attributes as Record<string, unknown>;

  if (typeof attrs.version !== 'string') {
    throw new Error('Manifest missing "attributes.version" string');
  }
  if (typeof attrs.createdAt !== 'string') {
    throw new Error('Manifest missing "attributes.createdAt" string');
  }
  if (!Array.isArray(attrs.entries)) {
    throw new Error('Manifest missing "attributes.entries" array');
  }

  const validRules: ManifestRule[] = ['copy', 'reference', 'exclude', 'export'];

  for (const entry of attrs.entries) {
    if (typeof entry.path !== 'string') {
      throw new Error('Manifest entry missing "path" string');
    }
    if (typeof entry.contentType !== 'string') {
      throw new Error(`Manifest entry "${entry.path}" missing "contentType"`);
    }
    if (typeof entry.size !== 'number') {
      throw new Error(`Manifest entry "${entry.path}" missing "size" number`);
    }
    if (typeof entry.hash !== 'string') {
      throw new Error(`Manifest entry "${entry.path}" missing "hash" string`);
    }

    // Validate rule field — treat missing rule as 'copy' for backward compat
    const rule = entry.rule || 'copy';
    if (!validRules.includes(rule)) {
      throw new Error(`Manifest entry "${entry.path}" has invalid rule "${rule}"`);
    }
    if (rule === 'reference' && typeof entry.referenceUrl !== 'string') {
      throw new Error(`Manifest entry "${entry.path}" with rule "reference" missing "referenceUrl"`);
    }
    if (rule === 'export' && typeof entry.transform !== 'string') {
      throw new Error(`Manifest entry "${entry.path}" with rule "export" missing "transform"`);
    }
  }
}

export function validateManifestAgainstFiles(
  manifest: ManifestCard,
  actualFiles: Map<string, { size: number; hash: string }>,
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  for (const entry of manifest.attributes.entries) {
    // Entries with 'exclude' or 'reference' rules have no file content in the archive
    const rule = entry.rule || 'copy';
    if (rule === 'exclude' || rule === 'reference') continue;

    const actual = actualFiles.get(entry.path);
    if (!actual) {
      errors.push(`Manifest lists "${entry.path}" but file missing from archive`);
      continue;
    }
    if (actual.size !== entry.size) {
      errors.push(
        `Size mismatch for "${entry.path}": manifest=${entry.size}, actual=${actual.size}`,
      );
    }
    if (actual.hash !== entry.hash) {
      errors.push(
        `Hash mismatch for "${entry.path}": manifest=${entry.hash}, actual=${actual.hash}`,
      );
    }
  }

  for (const [filePath] of actualFiles) {
    if (filePath === MANIFEST_FILENAME) continue;
    const inManifest = manifest.attributes.entries.some((e) => e.path === filePath);
    if (!inManifest) {
      errors.push(`Archive contains "${filePath}" not listed in manifest`);
    }
  }

  return { valid: errors.length === 0, errors };
}
