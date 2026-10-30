// File: tests/ui/fixtureSession.mjs
/**
 * Shared helper for the Playwright UI specs: serves a session JSON and the synthetic signed-PDF
 * fixtures from scripts/generate-signature-fixtures.mjs from memory (request interception,
 * nothing written to disk) and opens the viewer with `?sessionurl=`.
 */
import { createSignatureFixtures } from '../../scripts/generate-signature-fixtures.mjs';
import { createAnnotationFixture } from '../../scripts/generate-annotation-fixtures.mjs';

/** @type {(Map<string, Uint8Array>|null)} */
let cachedFixtures = null;

/** @returns {Promise<Map<string, Uint8Array>>} */
export async function getFixtures() {
  if (!cachedFixtures) {
    const generated = await createSignatureFixtures();
    cachedFixtures = generated instanceof Map ? generated : new Map(Object.entries(generated));
    cachedFixtures.set('annotation-widgets.pdf', createAnnotationFixture());
  }
  return cachedFixtures;
}

/**
 * Session layout used by the specs (thumbnail page = session page):
 *   DOK 1 = valid-rsa.pdf (page 1) + two-signatures.pdf (page 2) -> 3 signatures, two signed files
 *   DOK 2 = unsigned.pdf (page 3)
 *   DOK 3 = extended-after-signing.pdf (page 4) -> warning severity
 */
export const DEFAULT_SESSION = {
  session: { id: 'ui-signature-symbols' },
  documents: [
    { documentId: 'doc-a', files: ['/ui-fixtures/valid-rsa.pdf', '/ui-fixtures/two-signatures.pdf'] },
    { documentId: 'doc-b', files: ['/ui-fixtures/unsigned.pdf'] },
    { documentId: 'doc-c', files: ['/ui-fixtures/extended-after-signing.pdf'] },
  ],
};

/**
 * Serve the session and fixtures from memory and open the viewer.
 * @param {import('@playwright/test').Page} page
 * @param {{ siteConfig?:Object, session?:Object, query?:string, extraFixtures?:Map<string, { body:(Uint8Array|Buffer), contentType:string }>, transformIndexHtml?:function(string): string }} [options]
 *   `query` is appended to the viewer URL, e.g. `lng=sv`. `extraFixtures` adds files under
 *   `/ui-fixtures/` by name, served with their own content type (e.g. a synthetic PNG scan).
 *   `transformIndexHtml` rewrites the served index.html, e.g. to add a CSP token a site would add.
 */
export async function loadSession(page, {
  siteConfig = null, session = DEFAULT_SESSION, query = '', extraFixtures = null, transformIndexHtml = null,
} = {}) {
  const fixtures = await getFixtures();
  if (typeof transformIndexHtml === 'function') {
    await page.route((url) => url.pathname === '/' || url.pathname === '/index.html', async (route) => {
      const response = await route.fetch();
      const html = await response.text();
      await route.fulfill({ response, body: transformIndexHtml(html), headers: { ...response.headers(), 'content-type': 'text/html; charset=utf-8' } });
    });
  }
  if (siteConfig) {
    // Served like a deployment's odv.site.config.js; bootConfig only keeps overrides from that file.
    await page.route((url) => url.pathname === '/odv.site.config.js', (route) => route.fulfill({
      status: 200,
      contentType: 'text/javascript; charset=utf-8',
      body: `window.__ODV_SITE_CONFIG__ = ${JSON.stringify(siteConfig)};`,
    }));
  }
  await page.route((url) => url.pathname.startsWith('/ui-fixtures/'), async (route) => {
    const name = new URL(route.request().url()).pathname.split('/').pop();
    if (name === 'session.json') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(session) });
      return;
    }
    const extra = extraFixtures?.get?.(name);
    if (extra) {
      await route.fulfill({ status: 200, contentType: extra.contentType, body: Buffer.from(extra.body) });
      return;
    }
    const bytes = fixtures.get(name);
    if (!bytes) {
      await route.fulfill({ status: 404, body: 'missing fixture' });
      return;
    }
    await route.fulfill({ status: 200, contentType: 'application/pdf', body: Buffer.from(bytes) });
  });
  await page.goto(`/?sessionurl=/ui-fixtures/session.json${query ? `&${query}` : ''}`);
}

/** @param {{x:number,y:number,width:number,height:number}} a @param {{x:number,y:number,width:number,height:number}} b */
export function intersects(a, b) {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}
