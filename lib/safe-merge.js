import { MergeError, ERROR_CODES } from './errors.js';

export const DEFAULT_LIMITS = Object.freeze({
  maxDepth: 100,
  maxProperties: 1000,
  maxArrayLength: 10000,
  maxStringLength: 10000,
  maxTotalStringLength: 200000
});

const DANGEROUS_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const ARRAY_INDEX_RE = /^(0|[1-9][0-9]*)$/;

export function safeMerge(defaultConfig, userConfig, options = {}) {
  const limits = validateLimits(options.limits);
  const ctx = createContext(limits);
  return mergeValue(defaultConfig, userConfig, [], ctx);
}

function createContext(limits) {
  return {
    limits,
    depth: 0,
    totalStringLength: 0,
    seen: new WeakMap(),
    active: new WeakSet()
  };
}

function validateLimits(custom) {
  const limits = { ...DEFAULT_LIMITS };
  if (custom === undefined || custom === null) {
    return limits;
  }
  if (custom === null || typeof custom !== 'object' || Array.isArray(custom)) {
    throw new MergeError(
      ERROR_CODES.INVALID_LIMIT,
      'limits must be a plain object'
    );
  }
  for (const key of Object.keys(DEFAULT_LIMITS)) {
    if (!(key in custom)) {
      continue;
    }
    const value = custom[key];
    if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
      throw new MergeError(
        ERROR_CODES.INVALID_LIMIT,
        `limits.${key} must be a positive integer, received ${String(value)}`
      );
    }
    limits[key] = value;
  }
  return limits;
}

function mergeValue(defaultValue, userValue, path, ctx) {
  if (userValue === undefined) {
    throw new MergeError(
      ERROR_CODES.UNSUPPORTED_TYPE,
      'undefined is not a supported JSON value',
      path
    );
  }

  const defaultKind = classifyValue(defaultValue, path, 'default');
  const userKind = classifyValue(userValue, path, 'user');

  if (userKind !== 'object' && userKind !== 'array') {
    chargeString(userValue, userKind, path, ctx);
    return userValue;
  }

  if (defaultKind === 'object' && userKind === 'object') {
    if (defaultValue === userValue) {
      return cloneContainer(userValue, path, ctx);
    }
    return mergeObject(defaultValue, userValue, path, ctx);
  }

  // Array vs array, or any type conflict (object vs array, container vs
  // primitive/null): the user value always wins and is deep-cloned.
  return cloneContainer(userValue, path, ctx);
}

function mergeObject(defaultObject, userObject, path, ctx) {
  if (ctx.active.has(userObject)) {
    throw new MergeError(
      ERROR_CODES.CIRCULAR_REFERENCE,
      'circular reference detected while visiting object',
      path
    );
  }
  if (ctx.active.has(defaultObject)) {
    throw new MergeError(
      ERROR_CODES.CIRCULAR_REFERENCE,
      'circular reference detected while visiting object',
      path
    );
  }
  const existing = ctx.seen.get(userObject);
  if (existing !== undefined) {
    return existing;
  }
  beginLevel([userObject, defaultObject], path, ctx);

  const defaultEntries = inspectEntries(defaultObject, false, path, ctx);
  const userEntries = inspectEntries(userObject, false, path, ctx);
  checkPropertyCount(defaultEntries.length, userEntries.length, path, ctx);

  const output = {};

  const orderedKeys = [];
  const keySet = new Set();
  for (const [key] of defaultEntries) {
    orderedKeys.push(key);
    keySet.add(key);
  }
  for (const [key] of userEntries) {
    if (!keySet.has(key)) {
      orderedKeys.push(key);
      keySet.add(key);
    }
  }

  const userMap = new Map(userEntries);
  const defaultMap = new Map(defaultEntries);

  try {
    for (const key of orderedKeys) {
      const childPath = path.concat(key);
      const hasUserKey = userMap.has(key);
      const hasDefaultKey = defaultMap.has(key);
      if (hasUserKey && hasDefaultKey) {
        const result = mergeValue(
          defaultMap.get(key),
          userMap.get(key),
          childPath,
          ctx
        );
        defineDataProperty(output, key, result);
      } else if (hasUserKey) {
        defineDataProperty(
          output,
          key,
          cloneValue(userMap.get(key), childPath, ctx)
        );
      } else {
        defineDataProperty(
          output,
          key,
          cloneValue(defaultMap.get(key), childPath, ctx)
        );
      }
    }
  } finally {
    endLevel([userObject, defaultObject], ctx);
  }

  ctx.seen.set(userObject, output);
  ctx.seen.set(defaultObject, output);
  return output;
}

function cloneValue(value, path, ctx) {
  const kind = classifyValue(value, path, 'input');
  if (kind !== 'object' && kind !== 'array') {
    chargeString(value, kind, path, ctx);
    return value;
  }
  return cloneContainer(value, path, ctx);
}

function cloneContainer(container, path, ctx) {
  const isArray = Array.isArray(container);
  if (ctx.active.has(container)) {
    throw new MergeError(
      ERROR_CODES.CIRCULAR_REFERENCE,
      `circular reference detected while visiting ${isArray ? 'array' : 'object'}`,
      path
    );
  }
  if (ctx.seen.has(container)) {
    return ctx.seen.get(container);
  }

  beginLevel([container], path, ctx);
  const entries = inspectEntries(container, isArray, path, ctx);

  if (isArray) {
    checkPropertyCount(entries.length, 0, path, ctx);
    const output = new Array(container.length);
    try {
      for (const [index, value] of entries) {
        output[index] = cloneValue(value, path.concat(index), ctx);
      }
    } finally {
      endLevel([container], ctx);
    }
    ctx.seen.set(container, output);
    return output;
  }

  checkPropertyCount(entries.length, 0, path, ctx);
  const output = {};
  try {
    for (const [key, value] of entries) {
      defineDataProperty(output, key, cloneValue(value, path.concat(key), ctx));
    }
  } finally {
    endLevel([container], ctx);
  }
  ctx.seen.set(container, output);
  return output;
}

function beginLevel(containers, path, ctx) {
  if (ctx.depth >= ctx.limits.maxDepth) {
    throw new MergeError(
      ERROR_CODES.MAX_DEPTH,
      `max depth of ${ctx.limits.maxDepth} exceeded`,
      path
    );
  }
  ctx.depth += 1;
  for (const container of containers) {
    if (ctx.active.has(container)) {
      throw new MergeError(
        ERROR_CODES.CIRCULAR_REFERENCE,
        `circular reference detected while visiting ${
          Array.isArray(container) ? 'array' : 'object'
        }`,
        path
      );
    }
    ctx.active.add(container);
  }
}

function endLevel(containers, ctx) {
  ctx.depth -= 1;
  for (const container of containers) {
    ctx.active.delete(container);
  }
}

function inspectEntries(container, isArray, path, ctx) {
  const keys = Reflect.ownKeys(container);
  const entries = [];

  for (const key of keys) {
    if (typeof key === 'symbol') {
      throw new MergeError(
        ERROR_CODES.SYMBOL_KEY,
        'symbol keys are not supported; only string keys are allowed',
        path
      );
    }

    if (key === 'length') {
      continue;
    }

    if (DANGEROUS_KEYS.has(key)) {
      throw new MergeError(
        ERROR_CODES.DANGEROUS_KEY,
        `forbidden key "${key}" would allow prototype pollution`,
        path.concat(key)
      );
    }

    const descriptor = Object.getOwnPropertyDescriptor(container, key);
    if (!('value' in descriptor)) {
      throw new MergeError(
        ERROR_CODES.ACCESSOR_PROPERTY,
        `accessor property (getter/setter) "${key}" cannot be merged without invoking it`,
        path.concat(key)
      );
    }

    if (isArray) {
      if (!ARRAY_INDEX_RE.test(key) || Number(key) >= container.length) {
        throw new MergeError(
          ERROR_CODES.ARRAY_NON_INDEX_KEY,
          `array contains a non-index own property "${key}"`,
          path.concat(key)
        );
      }
    }

    entries.push([key, descriptor.value]);
  }

  if (isArray) {
    if (container.length > ctx.limits.maxArrayLength) {
      throw new MergeError(
        ERROR_CODES.MAX_ARRAY_LENGTH,
        `array length ${container.length} exceeds limit ${ctx.limits.maxArrayLength}`,
        path
      );
    }
    for (let index = 0; index < container.length; index += 1) {
      if (!Object.prototype.hasOwnProperty.call(container, index)) {
        throw new MergeError(
          ERROR_CODES.SPARSE_ARRAY,
          'sparse (hole) arrays are not supported',
          path.concat(index)
        );
      }
    }
  }

  return entries;
}

function checkPropertyCount(primaryCount, secondaryCount, path, ctx) {
  const count = primaryCount + secondaryCount;
  if (count > ctx.limits.maxProperties) {
    throw new MergeError(
      ERROR_CODES.MAX_PROPERTIES,
      `object property count ${count} exceeds limit ${ctx.limits.maxProperties}`,
      path
    );
  }
}

function chargeString(value, kind, path, ctx) {
  if (kind !== 'string') {
    return;
  }
  if (value.length > ctx.limits.maxStringLength) {
    throw new MergeError(
      ERROR_CODES.MAX_STRING_LENGTH,
      `string length ${value.length} exceeds limit ${ctx.limits.maxStringLength}`,
      path
    );
  }
  ctx.totalStringLength += value.length;
  if (ctx.totalStringLength > ctx.limits.maxTotalStringLength) {
    throw new MergeError(
      ERROR_CODES.MAX_TOTAL_STRING_LENGTH,
      `total string length exceeds limit ${ctx.limits.maxTotalStringLength}`,
      path
    );
  }
}

function classifyValue(value, path, source) {
  if (value === null) {
    return 'null';
  }
  if (value === undefined) {
    throw new MergeError(
      ERROR_CODES.UNSUPPORTED_TYPE,
      'undefined is not a supported JSON value',
      path
    );
  }

  const type = typeof value;
  if (type === 'string') {
    return 'string';
  }
  if (type === 'number') {
    if (!Number.isFinite(value)) {
      throw new MergeError(
        ERROR_CODES.UNSUPPORTED_TYPE,
        `${source} value is not a finite JSON number (NaN/Infinity)`,
        path
      );
    }
    return 'number';
  }
  if (type === 'boolean') {
    return 'boolean';
  }

  if (type === 'symbol' || type === 'bigint' || type === 'function') {
    throw new MergeError(
      ERROR_CODES.UNSUPPORTED_TYPE,
      `${source} value of type ${type} is not a supported JSON value`,
      path
    );
  }

  if (Array.isArray(value)) {
    return 'array';
  }

  if (isPlainObject(value)) {
    return 'object';
  }

  throw new MergeError(
    ERROR_CODES.UNSUPPORTED_TYPE,
    `${source} value has unsupported object type (only plain objects and arrays are allowed)`,
    path
  );
}

function isPlainObject(value) {
  if (value === null || typeof value !== 'object') {
    return false;
  }
  if (Array.isArray(value)) {
    return false;
  }
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function defineDataProperty(target, key, value) {
  Object.defineProperty(target, key, {
    value,
    writable: true,
    enumerable: true,
    configurable: true
  });
}
