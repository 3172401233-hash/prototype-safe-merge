import assert from 'node:assert/strict';

// Snapshot every own property descriptor of a value, recursively, including
// non-enumerable data properties. Used to prove that merges never mutate the
// inputs at either the value or descriptor level.
export function snapshotDescriptors(value, seen = new WeakMap()) {
  if (
    value === null ||
    typeof value !== 'object' ||
    (Array.isArray(value) === false &&
      Object.getPrototypeOf(value) !== Object.prototype &&
      Object.getPrototypeOf(value) !== null)
  ) {
    return {
      kind: 'leaf',
      type: value === null ? 'null' : typeof value
    };
  }
  if (seen.has(value)) {
    return { kind: 'seen' };
  }
  seen.set(value, true);

  const keys = Reflect.ownKeys(value);
  const snapshot = {
    kind: Array.isArray(value) ? 'array' : 'object',
    proto: Object.getPrototypeOf(value),
    length: Array.isArray(value) ? value.length : undefined,
    properties: {}
  };

  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    const entry = { descriptor: { ...descriptor } };
    if ('value' in descriptor && (typeof descriptor.value !== 'object' || isPlainSnapshot(descriptor.value))) {
      entry.snapshot = snapshotDescriptors(descriptor.value, seen);
    } else if ('value' in descriptor) {
      entry.snapshot = {
        kind: 'leaf',
        type: descriptor.value === null ? 'null' : typeof descriptor.value
      };
    }
    snapshot.properties[typeof key === 'symbol' ? key.toString() : key] = entry;
  }
  return snapshot;
}

function isPlainSnapshot(value) {
  if (value === null || typeof value !== 'object') {
    return true;
  }
  if (Array.isArray(value)) {
    return true;
  }
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

export function assertSnapshotsEqual(before, after, label) {
  assert.deepEqual(
    after,
    before,
    `${label} changed after merge (value or descriptor)`
  );
}

export function snapshotGlobals() {
  return {
    objectProto: snapshotPrototype(Object.prototype),
    arrayProto: snapshotPrototype(Array.prototype)
  };
}

function snapshotPrototype(proto) {
  const keys = Reflect.ownKeys(proto);
  const properties = {};
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(proto, key);
    properties[typeof key === 'symbol' ? key.toString() : key] = {
      enumerable: descriptor.enumerable,
      configurable: descriptor.configurable,
      writable: 'writable' in descriptor ? descriptor.writable : undefined,
      hasGetter: typeof descriptor.get === 'function',
      hasSetter: typeof descriptor.set === 'function',
      valueType: 'value' in descriptor ? typeof descriptor.value : undefined
    };
  }
  return { keys: keys.map((key) => String(key)), properties };
}

function assertPrototypeSnapshotEqual(before, after, label) {
  assert.deepEqual(after.keys, before.keys, `${label} key set changed`);
  for (const key of before.keys) {
    assert.deepEqual(
      after.properties[key],
      before.properties[key],
      `${label}.${key} descriptor changed`
    );
  }
}

export function assertGlobalsClean(before, marker = 'polluted') {
  assert.equal(
    Object.prototype[marker],
    undefined,
    'Object.prototype gained a polluted property'
  );
  assert.equal(
    Array.prototype[marker],
    undefined,
    'Array.prototype gained a polluted property'
  );
  assertPrototypeSnapshotEqual(
    before.objectProto,
    snapshotPrototype(Object.prototype),
    'Object.prototype descriptors'
  );
  assertPrototypeSnapshotEqual(
    before.arrayProto,
    snapshotPrototype(Array.prototype),
    'Array.prototype descriptors'
  );
}

export function defineAccessor(target, key) {
  Object.defineProperty(target, key, {
    enumerable: true,
    configurable: true,
    get() {
      throw new Error(`getter for "${key}" must never be invoked`);
    },
    set() {
      throw new Error(`setter for "${key}" must never be invoked`);
    }
  });
}
