export {
  createArchive,
  extractArchive,
  listArchive,
  addToArchive,
  removeFromArchive,
  rewriteArchive,
  type CreateOptions,
  type ExtractOptions,
  type ExtractResult,
  type ListResult,
} from './archive.js';

export {
  type ManifestCard,
  type ManifestEntry,
  type ManifestRule,
  type CreateManifestOptions,
  MANIFEST_FILENAME,
  CARDPACK_FORMAT_VERSION,
  parseManifest,
  serializeManifest,
  createManifest,
  validateManifestStructure,
  validateManifestAgainstFiles,
  computeSha256,
} from './manifest.js';

export { getContentType, isTextFile } from './content-type.js';
export { walkDirectory, type WalkedFile } from './file-walker.js';

export {
  discoverDependencies,
  parseGtsImports,
  parseGtsFields,
  buildImportMap,
  parseJsonAdoptsFrom,
  parseJsonRelationships,
  isExternalModule,
  resolveModulePath,
  resolveJsonRef,
  type Dependency,
  type ExternalReference,
  type DependencyResult,
} from './dependency-graph.js';

export {
  parseTransformArg,
  matchTransformRule,
  matchGlob,
  type TransformRuleSpec,
} from './transform-rules.js';

export {
  getTransform,
  listTransforms,
  type TransformFn,
  type TransformContext,
} from './transforms.js';

export {
  rewriteJsonUrls,
  rewriteGtsUrls,
  rewriteUrls,
  parseRewriteArgs,
  type RewriteRule,
  type RewriteResult,
} from './url-rewriter.js';

export {
  mergeArchive,
  type MergeOptions,
  type MergeResult,
  type MergeStrategy,
  type ConflictMode,
} from './merge.js';
