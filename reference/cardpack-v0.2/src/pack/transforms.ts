export interface TransformContext {
  filePath: string;
  contentType: string;
}

export type TransformFn = (content: Buffer, context: TransformContext) => Buffer;

const TRANSFORMS: Record<string, TransformFn> = {
  'sanitize-pii': sanitizePii,
  'default-config': defaultConfig,
  'strip-metadata': stripMetadata,
};

/**
 * Get a built-in transform by name. Throws if name is unknown.
 */
export function getTransform(name: string): TransformFn {
  const fn = TRANSFORMS[name];
  if (!fn) {
    throw new Error(
      `Unknown transform "${name}". Available transforms: ${listTransforms().join(', ')}`,
    );
  }
  return fn;
}

/**
 * List all available built-in transform names.
 */
export function listTransforms(): string[] {
  return Object.keys(TRANSFORMS);
}

// ---- BUILT-IN TRANSFORMS ----

const EMAIL_REGEX = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
const PHONE_REGEX = /(\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/g;

/**
 * Strip emails and phone numbers from all JSON string values.
 * Returns non-JSON content unchanged.
 */
export function sanitizePii(content: Buffer, _context: TransformContext): Buffer {
  let json: unknown;
  try {
    json = JSON.parse(content.toString('utf-8'));
  } catch {
    return content;
  }

  const sanitized = walkAndTransformStrings(json, (str) => {
    return str.replace(EMAIL_REGEX, '<email>').replace(PHONE_REGEX, '<phone>');
  });

  return Buffer.from(JSON.stringify(sanitized, null, 2), 'utf-8');
}

const SENSITIVE_KEYS = new Set([
  'apikey',
  'api_key',
  'secret',
  'token',
  'password',
  'privatekey',
  'private_key',
  'connectionstring',
  'connection_string',
]);

/**
 * Replace sensitive config values with "REPLACE_ME" placeholders.
 * Looks for common sensitive field names in JSON attributes.
 * Returns non-JSON content unchanged.
 */
export function defaultConfig(content: Buffer, _context: TransformContext): Buffer {
  let json: unknown;
  try {
    json = JSON.parse(content.toString('utf-8'));
  } catch {
    return content;
  }

  const transformed = walkAndTransformEntries(json, (key, value) => {
    if (typeof value === 'string' && SENSITIVE_KEYS.has(key.toLowerCase())) {
      return 'REPLACE_ME';
    }
    return value;
  });

  return Buffer.from(JSON.stringify(transformed, null, 2), 'utf-8');
}

const STRIP_META_KEYS = new Set(['realmInfo', 'realmURL', 'lastModified']);

/**
 * Remove internal metadata fields from JSON card instances.
 * Removes meta.realmInfo, meta.realmURL, meta.lastModified, and _-prefixed attribute keys.
 * Preserves meta.adoptsFrom.
 * Returns non-JSON content unchanged.
 */
export function stripMetadata(content: Buffer, _context: TransformContext): Buffer {
  let json: Record<string, unknown>;
  try {
    json = JSON.parse(content.toString('utf-8'));
  } catch {
    return content;
  }

  // Strip known meta keys (but preserve adoptsFrom)
  if (json.meta && typeof json.meta === 'object') {
    const meta = { ...(json.meta as Record<string, unknown>) };
    for (const key of STRIP_META_KEYS) {
      delete meta[key];
    }
    json = { ...json, meta };
  }

  // Strip _-prefixed attribute keys
  if (json.attributes && typeof json.attributes === 'object') {
    const attrs = { ...(json.attributes as Record<string, unknown>) };
    for (const key of Object.keys(attrs)) {
      if (key.startsWith('_')) {
        delete attrs[key];
      }
    }
    json = { ...json, attributes: attrs };
  }

  return Buffer.from(JSON.stringify(json, null, 2), 'utf-8');
}

// ---- HELPERS ----

/**
 * Recursively walk a JSON value and transform all string values.
 */
function walkAndTransformStrings(value: unknown, fn: (s: string) => string): unknown {
  if (typeof value === 'string') return fn(value);
  if (Array.isArray(value)) return value.map((v) => walkAndTransformStrings(v, fn));
  if (value && typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      result[k] = walkAndTransformStrings(v, fn);
    }
    return result;
  }
  return value;
}

/**
 * Recursively walk a JSON object and transform entries (key-value pairs).
 */
function walkAndTransformEntries(
  value: unknown,
  fn: (key: string, value: unknown) => unknown,
): unknown {
  if (Array.isArray(value)) return value.map((v) => walkAndTransformEntries(v, fn));
  if (value && typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      const transformed = fn(k, v);
      result[k] =
        transformed && typeof transformed === 'object'
          ? walkAndTransformEntries(transformed, fn)
          : transformed;
    }
    return result;
  }
  return value;
}
