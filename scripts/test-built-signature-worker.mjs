// Exercise the actual minified production worker after `npm run build`.
// Node supplies WebCrypto and a small worker-scope adapter; no browser/server needed.
import assert from 'node:assert/strict';
import { Worker } from 'node:worker_threads';
import { readdir } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { createSignatureFixtures } from './generate-signature-fixtures.mjs';

const entry = (await readdir('dist/assets')).find((name) => /^pdfSignatureWorker-.*\.js$/.test(name));
assert.ok(entry, 'Build the application before testing the production worker');
const fixtures = await createSignatureFixtures();
const workerUrl = pathToFileURL(path.resolve('dist/assets', entry)).href;
const harness = `const { parentPort } = require('node:worker_threads');
globalThis.self = { postMessage: message => parentPort.postMessage(message) };
import(${JSON.stringify(workerUrl)}).then(() => parentPort.on('message', data => self.onmessage({ data })));`;
const worker = new Worker(harness, { eval: true });
try {
  for (const [name, expected] of [
    ['valid-rsa.pdf', 'intact'], ['doc-timestamp-rfc3161.pdf', 'intact'],
    ['pkcs7-sha1.pdf', 'intact'], ['digest-mismatch.pdf', 'digest-mismatch'],
    ['corrupt-contents.pdf', 'unreadable'], ['extended-after-signing.pdf', 'modified-after-signing']
  ]) {
    const message = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => { cleanup(); reject(new Error('Built worker timeout')); }, 15000);
      const received = (value) => { cleanup(); resolve(value); };
      const failed = (error) => { cleanup(); reject(error); };
      function cleanup() { clearTimeout(timer); worker.off('message', received); worker.off('error', failed); }
      worker.once('message', received);
      worker.once('error', failed);
      worker.postMessage({ type: 'collectPdfSignatures', requestId: 1, bytes: fixtures[name] });
    });
    assert.equal(message.ok, true);
    assert.equal(message.report?.signatures?.[0]?.integrity, expected, name);
    console.log(`Production worker: ${name} -> ${expected}`);
  }
} finally { await worker.terminate(); }
