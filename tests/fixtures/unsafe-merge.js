// Deliberately vulnerable reference implementation.
//
// This code is intentionally unsafe and is only used to prove that the
// pollution payloads used by the test suite have a real triggering condition.
// It is kept in a separate module and always run inside a dedicated child
// process so it can never pollute the main test runner.

function isObjectLike(value) {
  return value !== null && (typeof value === 'object' || typeof value === 'function');
}

export function unsafeMerge(target, source) {
  // `for...in` walks the prototype chain; `target[key]` and `target[key] =`
  // invoke setters and resolve "__proto__" / "constructor" through the
  // prototype machinery. Every rule here is a known anti-pattern.
  for (const key in source) {
    const sourceValue = source[key];
    if (isObjectLike(sourceValue) && isObjectLike(target[key])) {
      unsafeMerge(target[key], sourceValue);
    } else {
      target[key] = sourceValue;
    }
  }
  return target;
}
