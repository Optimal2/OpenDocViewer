// Exercise the actual minified production worker after `npm run build`.
// Node supplies WebCrypto and a small worker-scope adapter; no browser/server needed.
import assert from 'node:assert/strict';
import { Worker } from 'node:worker_threads';
import { readdir } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { createSecurityFixtures } from './signature-security-fixtures.mjs';

const entry = (await readdir('dist/assets')).find((name) => /^pdfSignatureWorker-.*\.js$/.test(name));
assert.ok(entry, 'Build the application before testing the production worker');
const security = await createSecurityFixtures();
const fixtures = { ...security.normal, ...Object.fromEntries(Object.entries(security).filter(([, bytes]) => bytes instanceof Uint8Array)) };
const workerUrl = pathToFileURL(path.resolve('dist/assets', entry)).href;
const harness = `const { parentPort } = require('node:worker_threads');
globalThis.self = { postMessage: message => parentPort.postMessage(message) };
import(${JSON.stringify(workerUrl)}).then(() => parentPort.on('message', data => self.onmessage({ data })));`;
const worker = new Worker(harness, { eval: true });
try {
  // integrity + integrityCode per status-model row; minification must not change a verdict
  // (typed limit errors, curve OIDs and the pdf-lib wrapping all survive the production build).
  for (const [name, expected, expectedCode] of [
    ['valid-rsa.pdf', 'intact', null], ['doc-timestamp-rfc3161.pdf', 'intact', null],
    ['pkcs7-sha1.pdf', 'intact', null], ['cades-ecdsa-invisible.pdf', 'intact', null],
    ['digest-mismatch.pdf', 'digest-mismatch', 'content-digest-mismatch'],
    ['corrupt-contents.pdf', 'unreadable', 'cms-malformed'],
    ['extended-after-signing.pdf', 'modified-after-signing', 'unclassified-change-after-signing'],
    ['unsupported-subfilter.pdf', 'not-checked-in-viewer', 'format-unsupported'],
    ['unknownCurve', 'not-checked-in-viewer', 'algorithm-unsupported'],
    ['sha224Digest', 'not-checked-in-viewer', 'algorithm-unsupported'],
    ['structureFilterChain', 'not-checked-in-viewer', 'structure-unsupported'],
    ['encrypted', 'not-checked-in-viewer', 'encrypted'],
    ['wrongIssuer', 'unreadable', 'signer-certificate-missing']
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
    assert.equal(message.report?.signatures?.[0]?.integrityCode, expectedCode, name);
    console.log(`Production worker: ${name} -> ${expected} / ${expectedCode ?? '-'}`);
  }
} finally { await worker.terminate(); }
