import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { safeMerge, MergeError, ERROR_CODES } from '../lib/index.js';
import { snapshotGlobals, assertGlobalsClean } from './helpers.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const childScript = path.join(here, 'fixtures', 'pollution-child.mjs');

function runUnsafePayload(payloadName) {
  const stdout = execFileSync(process.execPath, [childScript, payloadName], {
    encoding: 'utf8'
  });
  return JSON.parse(stdout);
}

test('unsafe reference implementation really pollutes via __proto__ (child process)', () => {
  const result = runUnsafePayload('jsonProto');
  assert.equal(result.ok, true);
  assert.equal(result.polluted, true);

  // The child process is isolated: this runner's prototypes must be intact.
  assert.equal({}.polluted, undefined);

  const globalsBefore = snapshotGlobals();
  assert.throws(
    () => safeMerge({}, JSON.parse('{"__proto__":{"polluted":"yes"}}')),
    (error) =>
      error instanceof MergeError &&
      error.code === ERROR_CODES.DANGEROUS_KEY &&
      error.pathString === '__proto__'
  );
  assertGlobalsClean(globalsBefore);
});

test('unsafe reference implementation really pollutes via constructor.prototype (child process)', () => {
  const result = runUnsafePayload('constructorPrototype');
  assert.equal(result.ok, true);
  assert.equal(result.polluted, true);

  assert.equal({}.polluted, undefined);

  const globalsBefore = snapshotGlobals();
  const payload = JSON.parse(
    '{"constructor":{"prototype":{"polluted":"yes"}}}'
  );
  assert.throws(
    () => safeMerge({}, payload),
    (error) =>
      error.code === ERROR_CODES.DANGEROUS_KEY &&
      error.pathString === 'constructor'
  );
  assertGlobalsClean(globalsBefore);
});

test('each child process is independent: repeated runs do not leak state', () => {
  for (let i = 0; i < 3; i += 1) {
    const result = runUnsafePayload('jsonProto');
    assert.equal(result.polluted, true);
  }
  assert.equal({}.polluted, undefined);
  assertGlobalsClean(snapshotGlobals());
});
