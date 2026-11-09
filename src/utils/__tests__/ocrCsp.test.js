import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const read = (path) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8');
const html = read('../../../index.html');
const webConfig = read('../../../public/web.config');
const meta = html.match(/http-equiv="Content-Security-Policy"\s+content="([^"]+)"/)[1];
const headers = [...webConfig.matchAll(/name="Content-Security-Policy"\s+value="([^"]+)"/g)]
  .map((match) => match[1]);
// (location path, policy) pairs for CSP headers set inside a <location> block. The first match
// per block wins, so the commented-out narrower example inside the viewer block stays out.
const locationPolicies = [...webConfig.matchAll(
  /<location path="([^"]+)">(?:(?!<location)[\s\S])*?name="Content-Security-Policy"\s+value="([^"]+)"/g,
)].map((match) => ({ path: match[1], policy: match[2] }));

describe('shipped OCR CSP', () => {
  it.each([['HTML meta', meta], ...headers.map((policy, index) => [`IIS policy ${index}`, policy])])(
    '%s permits Wasm without permitting JavaScript string evaluation or new script origins',
    (_name, policy) => {
      const sources = policy.match(/(?:^|;)\s*script-src\s+([^;]+)/)[1].trim().split(/\s+/);
      expect(sources).toContain("'self'");
      expect(sources).toContain("'wasm-unsafe-eval'");
      expect(sources.every((source) => ["'self'", "'wasm-unsafe-eval'"].includes(source)
        || /^'sha256-[^']+'$/.test(source))).toBe(true);
    },
  );
  it('viewer policies pin the inline shell script; only the script-less manual page ships no hash', () => {
    const manual = locationPolicies.find(({ path }) => path === 'manual/index.html');
    expect(manual, 'manual/index.html sets its own Content-Security-Policy').toBeTruthy();
    // The manual page ships no inline script (proven in scripts/web-config-manual.test.mjs),
    // so its policy must allowlist no hash — and every other policy must pin one.
    expect(manual.policy).not.toMatch(/'sha256-[^']*'/);
    for (const policy of [meta, ...headers.filter((other) => other !== manual.policy)]) {
      const sources = policy.match(/(?:^|;)\s*script-src\s+([^;]+)/)[1].trim().split(/\s+/);
      expect(sources.some((source) => /^'sha256-[^']+'$/.test(source))).toBe(true);
    }
  });
  it('checks the deployed IIS headers and the narrower deployment example', () => {
    expect(headers).toHaveLength(3);
  });
});
