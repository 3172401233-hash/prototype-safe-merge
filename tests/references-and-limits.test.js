import { test } from 'node:test';
import assert from 'node:assert/strict';
import { safeMerge, MergeError, ERROR_CODES, DEFAULT_LIMITS } from '../lib/index.js';
import {
  snapshotGlobals,
  assertGlobalsClean,
  snapshotDescriptors,
  assertSnapshotsEqual
} from './helpers.js';

test('shared references in the user input are cloned once and stay shared', () => {
  const shared = { id: 'same' };
  const user = { a: shared, b: { c: shared } };

  const result = safeMerge({}, user);

  assert.equal(result.a, result.b.c);
  assert.notEqual(result.a, shared);
  assert.deepEqual(result.a, { id: 'same' });
});

test('shared references in the default input are cloned once and stay shared', () => {
  const shared = { id: 'same' };
  const defaults = { a: shared, b: { c: shared } };

  const result = safeMerge(defaults, {});

  assert.equal(result.a, result.b.c);
  assert.notEqual(result.a, shared);
});

test('shared references inside arrays are preserved through cloning', () => {
  const shared = { id: 'same' };
  const user = { list: [shared, shared] };

  const result = safeMerge({}, user);

  assert.equal(result.list[0], result.list[1]);
});

test('circular references in the user input are rejected with their path', () => {
  const globalsBefore = snapshotGlobals();
  const user = { name: 'root' };
  user.self = user;
  const userBefore = snapshotDescriptors(user);

  assert.throws(
    () => safeMerge({}, user),
    (error) =>
      error instanceof MergeError &&
      error.code === ERROR_CODES.CIRCULAR_REFERENCE &&
      error.pathString === 'self'
  );
  assertSnapshotsEqual(userBefore, snapshotDescriptors(user), 'cyclic input');
  assertGlobalsClean(globalsBefore);
});

test('circular references inside arrays are rejected at the index path', () => {
  const list = [];
  list.push(list);
  assert.throws(
    () => safeMerge([], list),
    (error) =>
      error.code === ERROR_CODES.CIRCULAR_REFERENCE &&
      error.pathString === '[0]'
  );
});

test('deep cross-object cycles are rejected, not silently truncated', () => {
  const user = { outer: { inner: {} } };
  user.outer.inner.back = user;
  assert.throws(
    () => safeMerge({}, user),
    (error) => error.code === ERROR_CODES.CIRCULAR_REFERENCE
  );
});

function nestedObject(depth) {
  let node = { leaf: 1 };
  for (let i = 0; i < depth - 1; i += 1) {
    node = { child: node };
  }
  return node;
}

test('maxDepth is enforced while traversing, before building the full copy', () => {
  const user = nestedObject(DEFAULT_LIMITS.maxDepth + 5);
  assert.throws(
    () => safeMerge({}, user),
    (error) => error.code === ERROR_CODES.MAX_DEPTH
  );

  const atLimit = nestedObject(DEFAULT_LIMITS.maxDepth);
  assert.doesNotThrow(() => safeMerge({}, atLimit));
});

test('maxProperties is enforced per object', () => {
  const user = { oversized: Object.fromEntries(
    Array.from({ length: 12 }, (_, i) => [`k${i}`, i])
  ) };
  assert.throws(
    () => safeMerge({}, user, { limits: { maxProperties: 10 } }),
    (error) => error.code === ERROR_CODES.MAX_PROPERTIES
  );
});

test('maxArrayLength is enforced on each array', () => {
  const user = { list: [1, 2, 3, 4, 5] };
  assert.throws(
    () => safeMerge({}, user, { limits: { maxArrayLength: 4 } }),
    (error) => error.code === ERROR_CODES.MAX_ARRAY_LENGTH
  );
});

test('maxStringLength is enforced per string', () => {
  const user = { long: 'x'.repeat(20) };
  assert.throws(
    () => safeMerge({}, user, { limits: { maxStringLength: 19 } }),
    (error) => error.code === ERROR_CODES.MAX_STRING_LENGTH
  );
});

test('maxTotalStringLength accumulates across every string and fails mid-traversal', () => {
  const user = { a: 'x'.repeat(10), b: { c: 'y'.repeat(10) }, d: 'z'.repeat(10) };
  assert.throws(
    () => safeMerge({}, user, { limits: { maxTotalStringLength: 25 } }),
    (error) => error.code === ERROR_CODES.MAX_TOTAL_STRING_LENGTH
  );
});

test('string limits count default-only strings too, not just user strings', () => {
  const defaults = { kept: 'x'.repeat(30) };
  assert.throws(
    () => safeMerge(defaults, {}, { limits: { maxStringLength: 29 } }),
    (error) => error.code === ERROR_CODES.MAX_STRING_LENGTH
  );
});

test('invalid limit values are rejected up front', () => {
  for (const bad of [0, -1, 1.5, '10', null]) {
    assert.throws(
      () => safeMerge({}, {}, { limits: { maxDepth: bad } }),
      (error) => error.code === ERROR_CODES.INVALID_LIMIT
    );
  }
});

test('failed merges leave both inputs untouched', () => {
  const defaults = nestedObject(3);
  const user = { good: 1, bad: JSON.parse('{"__proto__":{"x":1}}') };
  const defaultsBefore = snapshotDescriptors(defaults);
  const userBefore = snapshotDescriptors(user);

  assert.throws(() => safeMerge(defaults, user));

  assertSnapshotsEqual(defaultsBefore, snapshotDescriptors(defaults), 'defaults');
  assertSnapshotsEqual(userBefore, snapshotDescriptors(user), 'user input');
});
