import * as fs from 'fs';
import * as path from 'path';

/**
 * Represents a discovered dependency — either a local file or an external reference.
 */
export interface Dependency {
  /** Relative path within the workspace (e.g., "blog-post.gts", "BlogPost/welcome.json") */
  relativePath: string;
  /** How this dependency was discovered */
  reason: 'root' | 'gts-import' | 'gts-field' | 'json-adopts-from' | 'json-relationship';
  /** The file that referenced this dependency */
  referencedBy?: string;
}

/**
 * An external reference that lives outside the workspace (cross-realm).
 */
export interface ExternalReference {
  /** The URL or module specifier */
  url: string;
  /** How it was discovered */
  reason: 'gts-import' | 'gts-field' | 'json-adopts-from' | 'json-relationship';
  /** The file that referenced it */
  referencedBy: string;
}

export interface DependencyResult {
  /** Local files that should be included in the pack */
  files: Dependency[];
  /** External references (cross-realm URLs) — recorded but not included */
  externalRefs: ExternalReference[];
}

// ---- GTS PARSING ----

/**
 * Parses a .gts file and extracts:
 * - Import module specifiers
 * - Field declarations that reference other cards (linksTo, linksToMany, contains, containsMany)
 */
export function parseGtsImports(source: string): string[] {
  const modules: string[] = [];

  // Match import statements: import ... from 'module'  or  import ... from "module"
  const importRegex = /import\s+(?:[\s\S]*?)\s+from\s+['"]([^'"]+)['"]/g;
  let match;
  while ((match = importRegex.exec(source)) !== null) {
    modules.push(match[1]);
  }

  return modules;
}

/**
 * Extracts field type references from GTS source.
 * Matches patterns like:
 *   @field author = linksTo(Author)
 *   @field tags = linksToMany(Tag)
 *   @field body = contains(TextBlock)
 *   @field items = containsMany(ListItem)
 */
export function parseGtsFields(source: string): string[] {
  const fieldTypes: string[] = [];

  // Match @field x = linksTo(Type), linksToMany(Type), contains(Type), containsMany(Type)
  const fieldRegex = /@field\s+\w+\s*=\s*(?:linksTo|linksToMany|contains|containsMany)\s*\(\s*(\w+)/g;
  let match;
  while ((match = fieldRegex.exec(source)) !== null) {
    fieldTypes.push(match[1]);
  }

  return fieldTypes;
}

/**
 * Builds a map of imported name → module specifier from import statements.
 * e.g., `import { Author } from './author'` → { Author: './author' }
 */
export function buildImportMap(source: string): Map<string, string> {
  const importMap = new Map<string, string>();

  // Named imports: import { Foo, Bar } from 'module'
  const namedRegex = /import\s*\{([^}]+)\}\s*from\s*['"]([^'"]+)['"]/g;
  let match;
  while ((match = namedRegex.exec(source)) !== null) {
    const names = match[1].split(',').map((n) => {
      // Handle `Foo as Bar` — we want the local name (Bar)
      const parts = n.trim().split(/\s+as\s+/);
      return { imported: parts[0].trim(), local: (parts[1] || parts[0]).trim() };
    });
    for (const { local } of names) {
      if (local) importMap.set(local, match[2]);
    }
  }

  // Default imports: import Foo from 'module'
  const defaultRegex = /import\s+(\w+)\s+from\s*['"]([^'"]+)['"]/g;
  while ((match = defaultRegex.exec(source)) !== null) {
    importMap.set(match[1], match[2]);
  }

  return importMap;
}

// ---- JSON PARSING ----

/**
 * Parses a card instance JSON and extracts the adoptsFrom module reference.
 * Returns the module path or null if not found.
 */
export function parseJsonAdoptsFrom(json: Record<string, unknown>): string | null {
  const meta = json.meta as Record<string, unknown> | undefined;
  if (!meta) return null;

  const adoptsFrom = meta.adoptsFrom as Record<string, unknown> | undefined;
  if (!adoptsFrom) return null;

  const module = adoptsFrom.module;
  if (typeof module !== 'string') return null;

  return module;
}

/**
 * Parses relationship references from a card instance JSON.
 * Returns an array of relative paths referenced by relationships.
 *
 * Handles both single relationships:
 *   "relationships": { "author": { "links": { "self": "../Author/jane-doe" } } }
 *
 * And linksToMany numbered keys:
 *   "relationships": { "tags.0": { "links": { "self": "../Tag/tech" } }, "tags.1": ... }
 */
export function parseJsonRelationships(json: Record<string, unknown>): string[] {
  const refs: string[] = [];

  const relationships = json.relationships as Record<string, unknown> | undefined;
  if (!relationships) return refs;

  for (const value of Object.values(relationships)) {
    const rel = value as Record<string, unknown> | undefined;
    if (!rel) continue;

    const links = rel.links as Record<string, unknown> | undefined;
    if (!links) continue;

    const self = links.self;
    if (typeof self === 'string') {
      refs.push(self);
    }
  }

  return refs;
}

// ---- MODULE RESOLUTION ----

/**
 * Checks if a module specifier is an external URL (cross-realm reference).
 */
export function isExternalModule(moduleSpecifier: string): boolean {
  return moduleSpecifier.startsWith('https://') || moduleSpecifier.startsWith('http://');
}

/**
 * Resolves a module specifier relative to a source file within the workspace.
 * Tries various file extensions (.gts, .ts, .js, .json) if the path doesn't have one.
 *
 * @param moduleSpecifier - The import path (e.g., './author', '../blog-post')
 * @param fromFile - The file containing the import, relative to workspace root
 * @param workspaceDir - Absolute path to the workspace root
 * @returns The relative path within the workspace, or null if not found
 */
export function resolveModulePath(
  moduleSpecifier: string,
  fromFile: string,
  workspaceDir: string,
): string | null {
  // Determine the directory of the importing file
  const fromDir = path.dirname(path.join(workspaceDir, fromFile));
  const resolved = path.resolve(fromDir, moduleSpecifier);

  // If it already has an extension and exists, use it
  if (path.extname(resolved) && fs.existsSync(resolved)) {
    return path.relative(workspaceDir, resolved);
  }

  // Try extensions in priority order
  const extensions = ['.gts', '.ts', '.js', '.json'];
  for (const ext of extensions) {
    const candidate = resolved + ext;
    if (fs.existsSync(candidate)) {
      return path.relative(workspaceDir, candidate);
    }
  }

  // Try as a directory with index files
  for (const ext of extensions) {
    const candidate = path.join(resolved, `index${ext}`);
    if (fs.existsSync(candidate)) {
      return path.relative(workspaceDir, candidate);
    }
  }

  return null;
}

/**
 * Resolves a JSON relationship reference to a file path.
 * JSON relationships are like "../Author/jane-doe" — they point to
 * instance directories/files without a .json extension.
 *
 * @param ref - The relationship reference (e.g., "../Author/jane-doe")
 * @param fromFile - The JSON file containing the reference, relative to workspace root
 * @param workspaceDir - Absolute path to the workspace root
 * @returns The relative path within the workspace, or null if not found
 */
export function resolveJsonRef(
  ref: string,
  fromFile: string,
  workspaceDir: string,
): string | null {
  const fromDir = path.dirname(path.join(workspaceDir, fromFile));
  const resolved = path.resolve(fromDir, ref);

  // Try with .json extension
  const withJson = resolved + '.json';
  if (fs.existsSync(withJson)) {
    return path.relative(workspaceDir, withJson);
  }

  // Try as-is (might already have extension)
  if (fs.existsSync(resolved) && fs.statSync(resolved).isFile()) {
    return path.relative(workspaceDir, resolved);
  }

  return null;
}

// ---- DEPENDENCY GRAPH WALKER ----

/**
 * Walks dependencies starting from a root card file, discovering all
 * local files that should be included in a cardpack.
 *
 * @param rootFile - Relative path to the root card (e.g., "blog-post.gts")
 * @param workspaceDir - Absolute path to the workspace root directory
 * @returns All discovered dependencies and external references
 */
export function discoverDependencies(
  rootFile: string,
  workspaceDir: string,
): DependencyResult {
  const resolvedWorkspace = path.resolve(workspaceDir);
  const visited = new Set<string>();
  const files: Dependency[] = [];
  const externalRefs: ExternalReference[] = [];
  const queue: Array<{ relativePath: string; reason: Dependency['reason']; referencedBy?: string }> = [];

  // Start with the root file
  queue.push({ relativePath: rootFile, reason: 'root' });

  while (queue.length > 0) {
    const item = queue.shift()!;
    const normalizedPath = normalizePath(item.relativePath);

    if (visited.has(normalizedPath)) continue;
    visited.add(normalizedPath);

    // Verify file exists
    const absolutePath = path.join(resolvedWorkspace, normalizedPath);
    if (!fs.existsSync(absolutePath) || !fs.statSync(absolutePath).isFile()) {
      continue;
    }

    files.push({
      relativePath: normalizedPath,
      reason: item.reason,
      referencedBy: item.referencedBy,
    });

    // Parse the file for more dependencies
    const ext = path.extname(normalizedPath).toLowerCase();

    if (ext === '.gts' || ext === '.ts') {
      const source = fs.readFileSync(absolutePath, 'utf-8');
      const importMap = buildImportMap(source);
      const fieldTypes = parseGtsFields(source);
      const allImports = parseGtsImports(source);

      // Process all import module specifiers
      for (const moduleSpec of allImports) {
        if (isExternalModule(moduleSpec)) {
          externalRefs.push({
            url: moduleSpec,
            reason: 'gts-import',
            referencedBy: normalizedPath,
          });
          continue;
        }

        const resolved = resolveModulePath(moduleSpec, normalizedPath, resolvedWorkspace);
        if (resolved) {
          queue.push({
            relativePath: resolved,
            reason: 'gts-import',
            referencedBy: normalizedPath,
          });
        }
      }

      // Process field type references — find which module each type came from
      for (const typeName of fieldTypes) {
        const moduleSpec = importMap.get(typeName);
        if (!moduleSpec) continue; // locally defined type, already in this file

        if (isExternalModule(moduleSpec)) {
          externalRefs.push({
            url: moduleSpec,
            reason: 'gts-field',
            referencedBy: normalizedPath,
          });
          continue;
        }

        const resolved = resolveModulePath(moduleSpec, normalizedPath, resolvedWorkspace);
        if (resolved && !visited.has(normalizePath(resolved))) {
          queue.push({
            relativePath: resolved,
            reason: 'gts-field',
            referencedBy: normalizedPath,
          });
        }
      }
    } else if (ext === '.json') {
      const content = fs.readFileSync(absolutePath, 'utf-8');
      let json: Record<string, unknown>;
      try {
        json = JSON.parse(content);
      } catch {
        continue; // skip invalid JSON
      }

      // Process adoptsFrom
      const adoptsModule = parseJsonAdoptsFrom(json);
      if (adoptsModule) {
        if (isExternalModule(adoptsModule)) {
          externalRefs.push({
            url: adoptsModule,
            reason: 'json-adopts-from',
            referencedBy: normalizedPath,
          });
        } else {
          const resolved = resolveModulePath(adoptsModule, normalizedPath, resolvedWorkspace);
          if (resolved) {
            queue.push({
              relativePath: resolved,
              reason: 'json-adopts-from',
              referencedBy: normalizedPath,
            });
          }
        }
      }

      // Process relationships
      const relationRefs = parseJsonRelationships(json);
      for (const ref of relationRefs) {
        if (isExternalModule(ref)) {
          externalRefs.push({
            url: ref,
            reason: 'json-relationship',
            referencedBy: normalizedPath,
          });
          continue;
        }

        const resolved = resolveJsonRef(ref, normalizedPath, resolvedWorkspace);
        if (resolved) {
          queue.push({
            relativePath: resolved,
            reason: 'json-relationship',
            referencedBy: normalizedPath,
          });
        }
      }
    }
  }

  return { files, externalRefs };
}

/**
 * Normalizes a path to use forward slashes and remove redundant segments.
 */
function normalizePath(p: string): string {
  return path.normalize(p).split(path.sep).join('/');
}
