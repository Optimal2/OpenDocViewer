import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const read = (path) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8');
const html = read('../../../index.html');
const webConfig = read('../../../public/web.config');
const meta = html.match(/http-equiv="Content-Security-Policy"\s+content="([^"]+)"/)[1];
const headers = [...webConfig.matchAll(/name="Content-Security-Policy"\s+value="([^"]+)"/g)]
  .map((match) => match[1]);

describe('shipped OCR CSP', () => {
  it.each([['HTML meta', meta], ...headers.map((policy, index) => [`IIS policy ${index}`, policy])])(
    '%s permits Wasm without permitting JavaScript string evaluation or new script origins',
    (_name, policy) => {
      const sources = policy.match(/(?:^|;)\s*script-src\s+([^;]+)/)[1].trim().split(/\s+/);
      expect(sources).toContain("'self'");
      expect(sources).toContain("'wasm-unsafe-eval'");
      expect(sources.some((source) => /^'sha256-[^']+'$/.test(source))).toBe(true);
      expect(sources.every((source) => ["'self'", "'wasm-unsafe-eval'"].includes(source)
        || /^'sha256-[^']+'$/.test(source))).toBe(true);
    },
  );
  it('checks both the deployed IIS header and the narrower deployment example', () => {
    expect(headers).toHaveLength(2);
  });
});
