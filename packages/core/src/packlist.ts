import {
  TREE_HASH_SPEC,
  treeHashFromEntries,
  type TreeHashEntry,
} from './tree-hash.ts';
import { CANONICAL_ZIP_SPEC } from './canonical-zip.ts';

// The packlist is the pack's manifest: the decklist plus transport facts.
// It records ONLY what transport needs — everything it says about content
// must be derivable from the tree, and it may never contradict the
// import map (which travels inside the pack verbatim, as a tree file).
//
// Reserved name: `packlist.json` sits at the zip root as the FIRST entry
// and is NOT part of the logical tree (it describes the tree). A deck tree
// may not contain its own root-level packlist.json.
//
// Determinism: a canonical pack must be byte-reproducible (round-trip law
// 2), so nothing in the packlist may come from a clock — provenance fields
// are caller-supplied inputs, never defaults.

export const PACKLIST_PATH = 'packlist.json';
export const PACK_FORMAT = 'deck-pack-v1';

export interface PacklistEntry {
  path: string;
  size: number;
  sha256: string;
}

export interface PackProvenance {
  sourceRealm?: string;
  sealChangeId?: string;
  createdBy?: string;
  createdAt?: string; // caller-supplied ISO time; omitted by default
}

// A faithful pack's packlist. Derived packs (sanitized, subset) add
// `derivedFrom`/`subsetOf` + a transforms record — deliberately NOT
// modeled yet; the server only ever emits faithful packs.
export interface Packlist {
  format: typeof PACK_FORMAT;
  canonicalZip: typeof CANONICAL_ZIP_SPEC;
  treeHash: { spec: typeof TREE_HASH_SPEC; hash: string };
  entries: PacklistEntry[];
  provenance?: PackProvenance;
}

export function createPacklist(
  files: readonly { path: string; size: number; sha256: string }[],
  provenance?: PackProvenance,
): Packlist {
  let hashEntries: TreeHashEntry[] = files.map(({ path, sha256 }) => ({
    path,
    sha256,
  }));
  let { treeHash, entries: sorted } = treeHashFromEntries(hashEntries);
  let sizeByPath = new Map(files.map((f) => [f.path, f.size]));
  return {
    format: PACK_FORMAT,
    canonicalZip: CANONICAL_ZIP_SPEC,
    treeHash: { spec: TREE_HASH_SPEC, hash: treeHash },
    entries: sorted.map(({ path, sha256 }) => ({
      path,
      size: sizeByPath.get(path)!,
      sha256,
    })),
    ...(provenance && Object.keys(provenance).length > 0 ? { provenance } : {}),
  };
}

export function serializePacklist(packlist: Packlist): Buffer {
  return Buffer.from(JSON.stringify(packlist, null, 2) + '\n', 'utf8');
}

export function parsePacklist(bytes: Buffer): Packlist {
  let parsed: unknown;
  try {
    parsed = JSON.parse(bytes.toString('utf8'));
  } catch {
    throw new Error('packlist.json is not valid JSON');
  }
  let p = parsed as Packlist;
  if (p?.format !== PACK_FORMAT) {
    throw new Error(
      `unsupported pack format: ${JSON.stringify((p as { format?: unknown })?.format)} (expected ${PACK_FORMAT})`,
    );
  }
  if (p.canonicalZip !== CANONICAL_ZIP_SPEC) {
    throw new Error(`unsupported canonical zip spec: ${p.canonicalZip}`);
  }
  if (p.treeHash?.spec !== TREE_HASH_SPEC || !p.treeHash?.hash) {
    throw new Error('packlist has no usable treeHash');
  }
  if (!Array.isArray(p.entries)) {
    throw new Error('packlist has no entries array');
  }
  for (let entry of p.entries) {
    if (
      typeof entry?.path !== 'string' ||
      typeof entry?.size !== 'number' ||
      typeof entry?.sha256 !== 'string'
    ) {
      throw new Error('packlist entry is malformed');
    }
  }
  return p;
}
