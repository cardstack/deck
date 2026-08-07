import type { ManifestRule } from './manifest.js';

export interface TransformRuleSpec {
  /** Glob pattern to match file paths */
  pattern: string;
  /** The manifest rule to apply */
  rule: ManifestRule;
  /** Transform name (required when rule === 'export') */
  transform?: string;
  /** Reference URL (required when rule === 'reference') */
  referenceUrl?: string;
}

/**
 * Parse a CLI --transform argument string.
 *
 * Format: "glob:rule" or "glob:rule:arg"
 * Examples:
 *   "Customer/*:exclude"
 *   "Author/*:export:sanitize-pii"
 *   "*.gts:reference:https://catalog.boxel.ai/"
 */
export function parseTransformArg(arg: string): TransformRuleSpec {
  const parts = arg.split(':');
  if (parts.length < 2) {
    throw new Error(`Invalid transform spec "${arg}": expected "glob:rule" or "glob:rule:arg"`);
  }

  const pattern = parts[0];
  const rule = parts[1] as ManifestRule;

  const validRules: ManifestRule[] = ['copy', 'reference', 'exclude', 'export'];
  if (!validRules.includes(rule)) {
    throw new Error(`Invalid transform rule "${rule}" in "${arg}". Valid rules: ${validRules.join(', ')}`);
  }

  const spec: TransformRuleSpec = { pattern, rule };

  if (rule === 'export') {
    if (parts.length < 3 || !parts[2]) {
      throw new Error(`Transform rule "export" requires a transform name: "glob:export:name"`);
    }
    spec.transform = parts[2];
  }

  if (rule === 'reference') {
    if (parts.length < 3 || !parts[2]) {
      throw new Error(`Transform rule "reference" requires a URL: "glob:reference:url"`);
    }
    // Rejoin remaining parts for URLs with colons (e.g., https://...)
    spec.referenceUrl = parts.slice(2).join(':');
  }

  return spec;
}

/**
 * Match a file path against an ordered list of transform rules.
 * First match wins. Returns a default 'copy' rule if no match.
 */
export function matchTransformRule(
  filePath: string,
  rules: TransformRuleSpec[],
): TransformRuleSpec {
  for (const rule of rules) {
    if (matchGlob(filePath, rule.pattern)) {
      return rule;
    }
  }
  return { pattern: '*', rule: 'copy' };
}

/**
 * Match a file path against a glob pattern.
 *
 * Supported patterns:
 * - `*` — matches everything
 * - `*.ext` — matches files with that extension (anywhere in the tree)
 * - `Dir/*` — matches files directly inside Dir (one level)
 * - `Dir/**` — matches files recursively under Dir
 * - `exact/path.ext` — exact match
 */
export function matchGlob(filePath: string, pattern: string): boolean {
  // Match everything
  if (pattern === '*') return true;

  // Extension match: *.ext — matches anywhere in tree
  if (pattern.startsWith('*.')) {
    const ext = pattern.slice(1); // e.g., ".gts"
    return filePath.endsWith(ext);
  }

  // Recursive directory match: Dir/**
  if (pattern.endsWith('/**')) {
    const dir = pattern.slice(0, -3);
    return filePath.startsWith(dir + '/');
  }

  // Single-level directory match: Dir/*
  if (pattern.endsWith('/*')) {
    const dir = pattern.slice(0, -2);
    if (!filePath.startsWith(dir + '/')) return false;
    // Must not have another slash after the directory prefix
    const rest = filePath.slice(dir.length + 1);
    return !rest.includes('/');
  }

  // Exact match
  return filePath === pattern;
}
