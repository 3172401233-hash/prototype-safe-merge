export const ERROR_CODES = Object.freeze({
  DANGEROUS_KEY: 'DANGEROUS_KEY',
  ACCESSOR_PROPERTY: 'ACCESSOR_PROPERTY',
  SYMBOL_KEY: 'SYMBOL_KEY',
  UNSUPPORTED_TYPE: 'UNSUPPORTED_TYPE',
  CIRCULAR_REFERENCE: 'CIRCULAR_REFERENCE',
  MAX_DEPTH: 'MAX_DEPTH',
  MAX_PROPERTIES: 'MAX_PROPERTIES',
  MAX_ARRAY_LENGTH: 'MAX_ARRAY_LENGTH',
  MAX_STRING_LENGTH: 'MAX_STRING_LENGTH',
  MAX_TOTAL_STRING_LENGTH: 'MAX_TOTAL_STRING_LENGTH',
  INVALID_LIMIT: 'INVALID_LIMIT',
  SPARSE_ARRAY: 'SPARSE_ARRAY',
  ARRAY_NON_INDEX_KEY: 'ARRAY_NON_INDEX_KEY'
});

export class MergeError extends Error {
  constructor(code, message, path) {
    const location = path && path.length > 0 ? ` at ${formatPath(path)}` : '';
    super(`${message}${location}`);
    this.name = 'MergeError';
    this.code = code;
    this.path = path ? path.slice() : [];
  }

  get pathString() {
    return formatPath(this.path);
  }
}

const IDENTIFIER_RE = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

export function formatPath(path) {
  if (!path || path.length === 0) {
    return '<root>';
  }
  let out = '';
  for (const segment of path) {
    if (typeof segment === 'number' || /^\d+$/.test(String(segment))) {
      out += `[${segment}]`;
    } else if (IDENTIFIER_RE.test(String(segment))) {
      out += out === '' ? String(segment) : `.${segment}`;
    } else {
      out += `[${JSON.stringify(String(segment))}]`;
    }
  }
  return out || '<root>';
}
