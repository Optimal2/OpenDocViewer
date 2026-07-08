import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const webConfigPath = resolve(import.meta.dirname, '..', 'web.config');
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

  it('keeps X-Content-Type-Options header', () => {
    expect(config).toMatch(/<add\s+name="X-Content-Type-Options"/);
  });
});
