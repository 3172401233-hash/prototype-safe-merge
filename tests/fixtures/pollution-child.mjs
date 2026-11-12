// Runs one unsafe-merge payload in an isolated child process and reports
// whether the vulnerable implementation actually pollutes a prototype.
import { unsafeMerge } from './unsafe-merge.js';

const payloadName = process.argv[2];

const payloads = {
  // Direct assignment through the "__proto__" accessor on a JSON-parsed object.
  jsonProto() {
    const target = {};
    const malicious = JSON.parse('{"__proto__":{"polluted":"yes"}}');
    unsafeMerge(target, malicious);
    return { polluted: {}.polluted === 'yes' };
  },

  // Gadget chain through the inherited "constructor" property.
  constructorPrototype() {
    const target = {};
    const malicious = JSON.parse(
      '{"constructor":{"prototype":{"polluted":"yes"}}}'
    );
    unsafeMerge(target, malicious);
    return { polluted: {}.polluted === 'yes' };
  }
};

const runner = payloads[payloadName];
if (!runner) {
  process.stdout.write(
    JSON.stringify({ ok: false, error: `unknown payload ${payloadName}` })
  );
  process.exit(2);
}

try {
  const result = runner();
  process.stdout.write(JSON.stringify({ ok: true, ...result }));
} catch (error) {
  process.stdout.write(
    JSON.stringify({ ok: false, error: String(error && error.message) })
  );
  process.exit(1);
}
