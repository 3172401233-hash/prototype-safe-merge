import { test } from 'node:test';
import assert from 'node:assert/strict';
import { safeMerge, MergeError, ERROR_CODES } from '../lib/index.js';
import {
  snapshotGlobals,
  assertGlobalsClean,
  snapshotDescriptors,
  assertSnapshotsEqual,
  defineAccessor
} from './helpers.js';

const DANGEROUS = ['__proto__', 'constructor', 'prototype'];

for (const key of DANGEROUS) {
  test(`rejects JSON.parse payload containing "${key}" with a concrete path`, () => {
    const globalsBefore = snapshotGlobals();
    const user = JSON.parse(`{"layer":{"${key}":{"polluted":"yes"}}}`);
    const userBefore = snapshotDescriptors(user);

    assert.throws(
      () => safeMerge({ layer: {} }, user),
      (error) =>
        error instanceof MergeError &&
        error.code === ERROR_CODES.DANGEROUS_KEY &&
        error.pathString === `layer.${key}`
    );

    assertSnapshotsEqual(userBefore, snapshotDescriptors(user), 'user input');
    assertGlobalsClean(globalsBefore);
  });
}

test('rejects dangerous keys inside arrays and reports the index path', () => {
  const globalsBefore = snapshotGlobals();
  const user = JSON.parse('[{"__proto__":{"polluted":"yes"}}]');

  assert.throws(
    () => safeMerge([], user),
    (error) =>
      error.code === ERROR_CODES.DANGEROUS_KEY &&
      error.pathString === '[0].__proto__'
  );
  assertGlobalsClean(globalsBefore);
});

test('rejects dangerous keys nested inside array elements', () => {
  const user = { list: [{ safe: 1 }, { prototype: { x: 1 } }] };
  assert.throws(
    () => safeMerge({}, user),
    (error) =>
      error.code === ERROR_CODES.DANGEROUS_KEY &&
      error.pathString === 'list[1].prototype'
  );
});

test('rejects dangerous keys present in the default input as well', () => {
  const defaults = JSON.parse('{"__proto__":{"x":1}}');
  assert.throws(
    () => safeMerge(defaults, {}),
    (error) => error.code === ERROR_CODES.DANGEROUS_KEY
  );
});

test('accessor properties on the user input are rejected without invoking them', () => {
  const globalsBefore = snapshotGlobals();
  const user = { trap: {} };
  defineAccessor(user.trap, 'secret');

  assert.throws(
    () => safeMerge({ trap: {} }, user),
    (error) =>
      error.code === ERROR_CODES.ACCESSOR_PROPERTY &&
      error.pathString === 'trap.secret'
  );
  assertGlobalsClean(globalsBefore);
});

test('accessor properties on the default input are rejected without invoking them', () => {
  const defaults = { trap: {} };
  defineAccessor(defaults.trap, 'secret');

  assert.throws(
    () => safeMerge(defaults, {}),
    (error) => error.code === ERROR_CODES.ACCESSOR_PROPERTY
  );
});

test('symbol keys are rejected and reported at the correct path', () => {
  const user = { layer: { [Symbol('x')]: 1 } };
  assert.throws(
    () => safeMerge({}, user),
    (error) =>
      error.code === ERROR_CODES.SYMBOL_KEY &&
      error.pathString === 'layer'
  );
});

test('inherited accessors are invisible: only own properties are inspected', () => {
  const user = {};
  defineAccessor(Object.prototype, 'inheritedTrap');
  try {
    const result = safeMerge({}, user);
    assert.deepEqual(result, {});
    assert.equal(
      Object.getOwnPropertyDescriptor(result, 'inheritedTrap'),
      undefined
    );
  } finally {
    delete Object.prototype.inheritedTrap;
  }
});

const unsupportedCases = [
  ['function', () => function named() {}],
  ['bigint', () => 1n],
  ['symbol', () => Symbol('s')],
  ['undefined', () => undefined],
  ['Date', () => new Date()],
  ['RegExp', () => /x/],
  ['Map', () => new Map()],
  ['class instance', () => new (class Point {})()]
];

for (const [label, make] of unsupportedCases) {
  test(`unsupported user value type "${label}" is rejected`, () => {
    assert.throws(
      () => safeMerge({ a: 1 }, { a: make() }),
      (error) => error.code === ERROR_CODES.UNSUPPORTED_TYPE
    );
  });

  test(`unsupported default value type "${label}" is rejected`, () => {
    assert.throws(
      () => safeMerge({ a: make() }, { a: 1 }),
      (error) => error.code === ERROR_CODES.UNSUPPORTED_TYPE
    );
  });
}

test('NaN and Infinity are rejected as non-JSON numbers', () => {
  assert.throws(
    () => safeMerge({ a: 1 }, { a: Number.NaN }),
    (error) => error.code === ERROR_CODES.UNSUPPORTED_TYPE
  );
  assert.throws(
    () => safeMerge({ a: 1 }, { a: Number.POSITIVE_INFINITY }),
    (error) => error.code === ERROR_CODES.UNSUPPORTED_TYPE
  );
});

test('sparse arrays are rejected', () => {
  const sparse = [1];
  sparse[3] = 4;
  assert.throws(
    () => safeMerge([], sparse),
    (error) => error.code === ERROR_CODES.SPARSE_ARRAY
  );
});

test('arrays with non-index own properties are rejected', () => {
  const arr = [1, 2];
  arr.named = 3;
  assert.throws(
    () => safeMerge([], arr),
    (error) => error.code === ERROR_CODES.ARRAY_NON_INDEX_KEY
  );
});

test('a Proxy whose trap throws cannot be force-inspected and surfaces an error', () => {
  const proxy = new Proxy(
    {},
    {
      getPrototypeOf() {
        throw new Error('proxy refuses inspection');
      }
    }
  );
  assert.throws(() => safeMerge({}, proxy));
});

test('prototype pollution gadget keys never alter Object.prototype', () => {
  const globalsBefore = snapshotGlobals();
  const payloads = [
    JSON.parse('{"__proto__":{"polluted":"yes"}}'),
    JSON.parse('{"constructor":{"prototype":{"polluted":"yes"}}}'),
    { nested: JSON.parse('{"__proto__":{"polluted":"yes"}}') }
  ];

  for (const payload of payloads) {
    assert.throws(() => safeMerge({}, payload));
  }
  assertGlobalsClean(globalsBefore);
});
