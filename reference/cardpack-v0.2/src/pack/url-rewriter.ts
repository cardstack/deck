import * as path from 'path';

export interface RewriteRule {
  from: string;
  to: string;
}

export interface RewriteResult {
  content: Buffer;
  rewriteCount: number;
}

/**
 * Rewrite URLs in a JSON card instance.
 * Walks the entire JSON tree and replaces string values whose prefix matches a rule.
 */
export function rewriteJsonUrls(content: Buffer, rules: RewriteRule[]): RewriteResult {
  if (rules.length === 0) return { content, rewriteCount: 0 };

  let json: unknown;
  try {
    json = JSON.parse(content.toString('utf-8'));
  } catch {
    return { content, rewriteCount: 0 };
  }

  let rewriteCount = 0;

  const rewritten = walkJson(json, (str) => {
    for (const rule of rules) {
      if (str.startsWith(rule.from)) {
        rewriteCount++;
        return rule.to + str.slice(rule.from.length);
      }
    }
    return str;
  });

  return {
    content: Buffer.from(JSON.stringify(rewritten, null, 2), 'utf-8'),
    rewriteCount,
  };
}

/**
 * Rewrite import specifiers in a GTS file.
 * Matches import ... from 'url' patterns and replaces matching prefixes.
 */
export function rewriteGtsUrls(content: Buffer, rules: RewriteRule[]): RewriteResult {
  if (rules.length === 0) return { content, rewriteCount: 0 };

  const source = content.toString('utf-8');
  let rewriteCount = 0;

  const rewritten = source.replace(
    /(from\s+['"])([^'"]+)(['"])/g,
    (_match, prefix, url, suffix) => {
      for (const rule of rules) {
        if (url.startsWith(rule.from)) {
          rewriteCount++;
          return prefix + rule.to + url.slice(rule.from.length) + suffix;
        }
      }
      return prefix + url + suffix;
    },
  );

  return {
    content: Buffer.from(rewritten, 'utf-8'),
    rewriteCount,
  };
}

/**
 * Rewrite URLs in content, auto-detecting file type by extension.
 * JSON files use JSON URL rewriting; GTS/TS files use import rewriting.
 * Other file types are returned unchanged.
 */
export function rewriteUrls(
  content: Buffer,
  filePath: string,
  rules: RewriteRule[],
): RewriteResult {
  if (rules.length === 0) return { content, rewriteCount: 0 };

  const ext = path.extname(filePath).toLowerCase();

  if (ext === '.json') {
    return rewriteJsonUrls(content, rules);
  }

  if (ext === '.gts' || ext === '.ts' || ext === '.js') {
    return rewriteGtsUrls(content, rules);
  }

  return { content, rewriteCount: 0 };
}

/**
 * Parse CLI --rewrite-urls arguments from a flat array of alternating from/to values.
 * e.g., ["https://old/", "https://new/", "https://a/", "https://b/"]
 */
export function parseRewriteArgs(args: string[]): RewriteRule[] {
  if (args.length % 2 !== 0) {
    throw new Error(
      `--rewrite-urls requires pairs of arguments (from, to). Got ${args.length} arguments.`,
    );
  }

  const rules: RewriteRule[] = [];
  for (let i = 0; i < args.length; i += 2) {
    rules.push({ from: args[i], to: args[i + 1] });
  }
  return rules;
}

// ---- HELPERS ----

/**
 * Recursively walk a JSON value and transform all string values.
 */
function walkJson(value: unknown, fn: (s: string) => string): unknown {
  if (typeof value === 'string') return fn(value);
  if (Array.isArray(value)) return value.map((v) => walkJson(v, fn));
  if (value && typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      result[k] = walkJson(v, fn);
    }
    return result;
  }
  return value;
}
