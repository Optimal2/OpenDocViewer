import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

// public/web.config is deployed verbatim with the SPA; this test lives outside public/ so it is
// never copied into dist/ and shipped to a server.
const webConfigPath = resolve(import.meta.dirname, '..', '..', 'public', 'web.config');
const config = readFileSync(webConfigPath, 'utf8');

const indexLocationMatch = config.match(
  /<location path="index\.html">[\s\S]*?<\/location>/
);
const indexLocation = indexLocationMatch ? indexLocationMatch[0] : '';

describe('public/web.config security headers', () => {
  it('adds X-Frame-Options: SAMEORIGIN globally', () => {
    expect(config).toMatch(/<add\s+name="X-Frame-Options"\s+value="SAMEORIGIN"\s*\/>/);
  });

  it('adds frame-ancestors self to the index.html CSP', () => {
    expect(indexLocation).toMatch(/frame-ancestors\s+'self';/);
  });

  it('keeps Permissions-Policy header', () => {
    expect(config).toMatch(/<add\s+name="Permissions-Policy"/);
  });

  it('keeps site-managed help content out of the immutable cache policy', () => {
    const helpLocationMatch = config.match(/<location path="help">[\s\S]*?<\/location>/);
    const helpLocation = helpLocationMatch ? helpLocationMatch[0] : '';
    expect(helpLocation).toMatch(/<add\s+name="Cache-Control"\s+value="no-cache, must-revalidate"\s*\/>/);
    expect(helpLocation).not.toMatch(/immutable/);
  });

  it('keeps missing help files out of the SPA fallback so the manual can fall back to help/default/', () => {
    // A missing help/site/manual.<lng>.html must answer 404, not index.html with 200; otherwise the
    // manual dialog shows the application shell instead of the bundled default manual.
    const spaRuleMatch = config.match(/<rule name="SPA fallback"[\s\S]*?<\/rule>/);
    const spaRule = spaRuleMatch ? spaRuleMatch[0] : '';
    expect(spaRule).toMatch(/<add\s+input="\{REQUEST_URI\}"\s+pattern="[^"]*help\/[^"]*"\s+negate="true"\s*\/>/);
  });

  it('keeps X-Content-Type-Options header', () => {
    expect(config).toMatch(/<add\s+name="X-Content-Type-Options"/);
  });
});
