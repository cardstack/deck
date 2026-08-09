// `@cardstack/deck/node` — everything that needs a filesystem.
//
// The companion to the root entry (see `index.ts` for why the root is the
// browser-safe one). This is what a server embeds: tree identity over real
// directories, the object store, packs, locking, verification, signatures.
//
// One entry rather than twenty-odd subpaths, because a consumer wants a
// contract, not an archaeology dig — and because every deep import is a
// promise about internal layout that this package would then owe forever.
// The granular subpaths still resolve; they are how this repo's own packages
// import, and they are not part of what an embedder should reach for.

export * from './index.ts';

export {
  TREE_HASH_SPEC,
  hashBytes,
  isValidTreePath,
  treeHashFromDir,
  treeHashFromEntries,
} from './tree-hash.ts';
export type { TreeHashEntry } from './tree-hash.ts';

export { pack, packFromDir, unpack } from './pack.ts';

export {
  PACKLIST_PATH,
  PACK_FORMAT,
  createPacklist,
  intakeReadiness,
  parsePacklist,
  serializePacklist,
} from './packlist.ts';
export type {
  PackMode,
  PackProvenance,
  Packlist,
  PacklistEntry,
  PrunedRecord,
} from './packlist.ts';

export { packagesFromPack } from './import-map-pack.ts';

export {
  inspectStore,
  listStorePackages,
  publishToStore,
  readStoreMeta,
  readStoredFile,
  readStoredPack,
  releaseVersion,
  resolveVersionSpec,
} from './store.ts';

export { verifyLinks } from './verify-links.ts';
