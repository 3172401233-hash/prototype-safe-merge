import { test } from 'node:test';
import assert from 'node:assert/strict';
import { safeMerge, MergeError, ERROR_CODES } from '../lib/index.js';
import { snapshotDescriptors, assertSnapshotsEqual } from './helpers.js';

test('recursively merges nested plain objects and deep-clones the result', () => {
  const defaults = { server: { host: 'localhost', port: 8080 }, keep: true };
  const user = { server: { port: 9000, tls: true }, extra: 'x' };

  const result = safeMerge(defaults, user);

  assert.deepEqual(result, {
    server: { host: 'localhost', port: 9000, tls: true },
    keep: true,
    extra: 'x'
  });
  assert.notEqual(result.server, defaults.server);
  assert.notEqual(result.server, user.server);
});

test('arrays are replaced wholesale, never merged element by element', () => {
  const defaults = { hosts: ['a', 'b'], nested: { list: [1, 2, 3] } };
  const user = { hosts: ['c'], nested: { list: [9] } };

  const result = safeMerge(defaults, user);

  assert.deepEqual(result.hosts, ['c']);
  assert.deepEqual(result.nested.list, [9]);
  assert.notEqual(result.hosts, user.hosts);
});

test('null overrides an object, and an object overrides null', () => {
  assert.deepEqual(safeMerge({ a: { x: 1 } }, { a: null }), { a: null });
  assert.deepEqual(safeMerge({ a: null }, { a: { x: 1 } }), { a: { x: 1 } });
});

test('false, 0 and empty string override truthy defaults; missing keys stay', () => {
  const defaults = { flag: true, count: 10, name: 'default', keep: 'k' };
  const user = { flag: false, count: 0, name: '' };

  const result = safeMerge(defaults, user);

  assert.equal(result.flag, false);
  assert.equal(result.count, 0);
  assert.equal(result.name, '');
  assert.equal(result.keep, 'k');
});

test('all JSON primitive types are supported and returned by value', () => {
  const result = safeMerge(
    { s: 'a', n: 1, b: true, u: null },
    { s: 'z', n: 2.5, b: false, u: null, e: -0 }
  );
  assert.deepEqual(result, {
    s: 'z',
    n: 2.5,
    b: false,
    u: null,
    e: -0
  });
});

test('type conflicts resolve in favor of the user value', () => {
  assert.deepEqual(safeMerge({ a: { x: 1 } }, { a: [1, 2] }), { a: [1, 2] });
  assert.deepEqual(safeMerge({ a: [1, 2] }, { a: { x: 1 } }), { a: { x: 1 } });
  assert.deepEqual(safeMerge({ a: 'str' }, { a: 42 }), { a: 42 });
  assert.deepEqual(safeMerge({ a: 42 }, { a: 'str' }), { a: 'str' });
});

test('objects inside arrays are deep-cloned and nested arrays replaced', () => {
  const defaults = { items: [{ id: 1 }] };
  const user = { items: [{ id: 2 }, { id: 3 }] };

  const result = safeMerge(defaults, user);

  assert.deepEqual(result, { items: [{ id: 2 }, { id: 3 }] });
  assert.notEqual(result.items[0], user.items[0]);
});

test('null-prototype objects are accepted and produced as normal plain objects', () => {
  const nullProto = Object.create(null);
  nullProto.a = 1;
  const result = safeMerge({ b: 2 }, { child: nullProto });

  assert.deepEqual(result, { b: 2, child: { a: 1 } });
  assert.equal(Object.getPrototypeOf(result.child), Object.prototype);
});

test('only own properties are read; a non-standard prototype makes the input unsupported', () => {
  const proto = { inherited: 'nope' };
  const user = Object.create(proto);
  user.own = 'yes';

  assert.throws(
    () => safeMerge({}, user),
    (error) => error.code === ERROR_CODES.UNSUPPORTED_TYPE
  );

  const plain = Object.create(Object.prototype);
  plain.own = 'yes';
  const result = safeMerge({}, plain);
  assert.deepEqual(result, { own: 'yes' });
  assert.ok(Object.prototype.hasOwnProperty.call(result, 'own'));
});

test('non-enumerable own data properties are included, preserving all own data', () => {
  const user = {};
  Object.defineProperty(user, 'hidden', {
    value: 1,
    enumerable: false,
    writable: true,
    configurable: true
  });

  const result = safeMerge({}, user);

  assert.equal(result.hidden, 1);
});

test('inputs and their descriptors are never modified by a successful merge', () => {
  const defaults = { s: { a: 1 }, arr: [1, { x: 1 }] };
  const user = { s: { b: 2 }, arr: [2] };
  const defaultsBefore = snapshotDescriptors(defaults);
  const userBefore = snapshotDescriptors(user);

  safeMerge(defaults, user);

  assertSnapshotsEqual(defaultsBefore, snapshotDescriptors(defaults), 'defaults');
  assertSnapshotsEqual(userBefore, snapshotDescriptors(user), 'user input');
});

test('the result shares no reference with either input', () => {
  const defaults = { shared: { deep: { v: 1 } } };
  const user = { other: { deep: { v: 2 } } };
  const result = safeMerge(defaults, user);

  result.shared.deep.v = 99;
  assert.equal(defaults.shared.deep.v, 1);
  result.other.deep.v = 99;
  assert.equal(user.other.deep.v, 2);
});

test('MergeError exposes a machine code and the offending property path', () => {
  try {
    safeMerge({}, JSON.parse('{"a":{"__proto__":{"x":1}}}'));
    assert.fail('expected throw');
  } catch (error) {
    assert.ok(error instanceof MergeError);
    assert.equal(error.code, ERROR_CODES.DANGEROUS_KEY);
    assert.equal(error.pathString, 'a.__proto__');
  }
});
