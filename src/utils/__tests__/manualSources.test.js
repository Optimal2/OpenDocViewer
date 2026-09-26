import { describe, it, expect } from 'vitest';
import { buildManualCandidates, resolveManualSource } from '../manualSources.js';

// A static host with an SPA fallback (IIS rewrite in public/web.config, the Vite dev server)
// answers a request for a missing file with the application shell and status 200.
const APP_SHELL = [
  '<!doctype html><html><head><title>OpenDocViewer</title></head><body>',
  '<div id="root" aria-live="polite"></div>',
  '<script type="module" data-odv-bootstrap src="./assets/bootConfig.js"></script>',
  '</body></html>',
].join('');

/**
 * Fake static host: `files` maps a path to its content; missing paths return 404, or the app
 * shell with 200 when `spaFallback` is set.
 */
function staticHost(files, { spaFallback = false } = {}) {
  const requested = [];
  const fetchCandidate = async (path) => {
    requested.push(path);
    if (Object.prototype.hasOwnProperty.call(files, path)) {
      return { ok: true, url: `http://host/odv/${path}`, text: async () => files[path] };
    }
    if (spaFallback) return { ok: true, url: `http://host/odv/${path}`, text: async () => APP_SHELL };
    return { ok: false, url: `http://host/odv/${path}`, text: async () => 'Not found' };
  };
  return { fetchCandidate, requested };
}

const SITE_SV = '<h1>Site manual (sv)</h1>';
const DEFAULT_SV = '<h1>Default manual (sv)</h1>';
const DEFAULT_EN = '<h1>Default manual (en)</h1>';

async function resolve(language, files, options) {
  const host = staticHost(files, options);
  const result = await resolveManualSource(buildManualCandidates(language, {}), host.fetchCandidate);
  return { result, requested: host.requested };
}

describe('manual source order: help/site before help/default', () => {
  it('orders candidates site before default, UI language before the fallback language', () => {
    expect(buildManualCandidates('sv', {})).toEqual([
      'help/site/manual.sv.html',
      'help/default/manual.sv.html',
      'help/site/manual.en.html',
      'help/default/manual.en.html',
    ]);
  });

  it('never lists sample files as candidates', () => {
    const candidates = buildManualCandidates('sv', {});
    expect(candidates.some((path) => path.includes('.sample.'))).toBe(false);
  });

  describe.each([
    ['a host without SPA fallback', { spaFallback: false }],
    ['a host with SPA fallback (missing files answer 200 with the app shell)', { spaFallback: true }],
  ])('on %s', (_label, options) => {
    it('uses the site manual when it exists', async () => {
      const { result } = await resolve('sv', {
        'help/site/manual.sv.html': SITE_SV,
        'help/default/manual.sv.html': DEFAULT_SV,
      }, options);
      expect(result.candidate).toBe('help/site/manual.sv.html');
      expect(result.html).toBe(SITE_SV);
    });

    it('uses the bundled default when the site manual is missing', async () => {
      const { result } = await resolve('sv', {
        'help/default/manual.sv.html': DEFAULT_SV,
        'help/default/manual.en.html': DEFAULT_EN,
      }, options);
      expect(result.candidate).toBe('help/default/manual.sv.html');
      expect(result.html).toBe(DEFAULT_SV);
    });

    it('does not count a sample file in help/site as a site manual', async () => {
      const { result, requested } = await resolve('sv', {
        'help/site/manual.sv.sample.html': '<h1>Site manual (sample)</h1>',
        'help/default/manual.sv.html': DEFAULT_SV,
      }, options);
      expect(result.candidate).toBe('help/default/manual.sv.html');
      expect(requested).not.toContain('help/site/manual.sv.sample.html');
    });

    it('falls back to the default manual in the fallback language', async () => {
      const { result } = await resolve('de', { 'help/default/manual.en.html': DEFAULT_EN }, options);
      expect(result.candidate).toBe('help/default/manual.en.html');
    });

    it('returns null when no manual exists at all', async () => {
      const { result } = await resolve('sv', {}, options);
      expect(result).toBeNull();
    });
  });

  it('keeps going after a network error on one candidate', async () => {
    const fetchCandidate = async (path) => {
      if (path === 'help/site/manual.sv.html') throw new TypeError('Failed to fetch');
      return { ok: true, url: path, text: async () => DEFAULT_SV };
    };
    const result = await resolveManualSource(buildManualCandidates('sv', {}), fetchCandidate);
    expect(result.candidate).toBe('help/default/manual.sv.html');
  });

  it('stops on abort', async () => {
    const fetchCandidate = async () => {
      const error = new Error('aborted');
      error.name = 'AbortError';
      throw error;
    };
    await expect(resolveManualSource(['help/site/manual.sv.html'], fetchCandidate)).rejects.toThrow('aborted');
  });
});
