// File: src/utils/__tests__/olderConfigNameWarnings.test.js
/**
 * The older configuration names that still win over the documented key are reported once per
 * page load and per name, by name only, and the precedence itself is unchanged.
 */

import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  findOlderConfigNamesInUse,
  resetOlderConfigNameWarnings,
  warnAboutOlderConfigNames,
} from '../olderConfigNameWarnings.js';
import { getPdfPrintCacheKeyOptions } from '../pdfPrintCacheKey.js';
import { createPdfPrebuildAllPagesVariants } from '../pdfPrebuildPlan.js';

const SECRET = 'SECRET-TOKEN-VALUE-1234';
const ENDPOINT = 'https://logs.example/ODVProxy/log';

let warn;

beforeEach(() => {
  resetOlderConfigNameWarnings();
  vi.stubGlobal('window', {});
  warn = vi.fn();
});

afterEach(() => vi.unstubAllGlobals());

/** Run the real public/odv.config.js with an optional site file and return what it publishes. */
function publish(prepare) {
  const dom = new JSDOM('<!doctype html>', { runScripts: 'outside-only' });
  try {
    prepare?.(dom.window);
    dom.window.eval(readFileSync('public/odv.config.js', 'utf8'));
    return JSON.parse(JSON.stringify(dom.window.__ODV_CONFIG__));
  } finally {
    dom.window.close();
  }
}

const GROUPS = [
  {
    group: 'system log',
    cases: [
      { older: 'logEndpoint', documented: 'systemLog.endpoint', site: { logEndpoint: ENDPOINT } },
      { older: 'logToken', documented: 'systemLog.token', site: { logToken: SECRET } },
      { older: 'logEnabled', documented: 'systemLog.enabled', site: { logEnabled: true } },
    ],
    documentedOnly: { systemLog: { endpoint: ENDPOINT, token: SECRET, enabled: true } },
  },
  {
    group: 'PDF orientation',
    cases: [
      {
        older: 'print.pdf.orientation.mode',
        documented: 'print.pdf.orientation.defaultAuto and print.pdf.orientation.fixedMode',
        site: { print: { pdf: { orientation: { mode: 'landscape' } } } },
      },
      {
        older: 'print.pdf.orientationMode',
        documented: 'print.pdf.orientation.defaultAuto and print.pdf.orientation.fixedMode',
        site: { print: { pdf: { orientationMode: 'landscape' } } },
      },
    ],
    documentedOnly: { print: { pdf: { orientation: { defaultAuto: false, fixedMode: 'landscape' } } } },
  },
  {
    group: 'PDF cache language mode',
    cases: [
      { older: 'languageMode', documented: 'print.pdf.cacheLanguageMode', site: { languageMode: 'ignore' } },
      { older: 'cacheLanguageMode', documented: 'print.pdf.cacheLanguageMode', site: { cacheLanguageMode: 'ignore' } },
    ],
    documentedOnly: { print: { pdf: { cacheLanguageMode: 'ignore' } } },
  },
];

describe.each(GROUPS)('older names: $group', ({ cases, documentedOnly }) => {
  it.each(cases)('warns exactly once for $older, naming it and the documented key', ({ older, documented, site }) => {
    const config = publish((window) => { window.__ODV_SITE_CONFIG__ = site; });

    // Also when only the older name is set: the site still has to rename it before the change.
    expect(warnAboutOlderConfigNames(config, warn)).toEqual([{ older, documented }]);
    // Further calls during the same page load stay silent, however often the readers run.
    for (let i = 0; i < 5; i += 1) {
      getPdfPrintCacheKeyOptions(config);
      createPdfPrebuildAllPagesVariants(config);
      expect(warnAboutOlderConfigNames(config, warn)).toEqual([]);
    }

    expect(warn).toHaveBeenCalledTimes(1);
    const message = warn.mock.calls[0][0];
    expect(warn.mock.calls[0]).toHaveLength(1);
    expect(message.startsWith('[ODV] Site config uses the older name ')).toBe(true);
    expect(message).toContain(`"${older}"`);
    expect(message).toContain(`"${documented}"`);
    expect(message).toContain('later major version');
  });

  it.each(cases)('does not put the value of $older in the warning', ({ site }) => {
    const both = publish((window) => {
      window.__ODV_SITE_CONFIG__ = JSON.parse(JSON.stringify({ ...documentedOnly, ...site }));
    });
    warnAboutOlderConfigNames(both, warn);
    const text = warn.mock.calls.map((call) => call.join(' ')).join('\n');
    for (const value of [SECRET, ENDPOINT, 'logs.example', 'landscape', 'ignore']) expect(text).not.toContain(value);
  });

  it('stays silent when the site uses only the documented keys', () => {
    const config = publish((window) => { window.__ODV_SITE_CONFIG__ = documentedOnly; });
    expect(findOlderConfigNamesInUse(config)).toEqual([]);
    expect(warnAboutOlderConfigNames(config, warn)).toEqual([]);
    expect(warn).not.toHaveBeenCalled();
  });
});

describe('older names: no warning without them', () => {
  it.each([
    ['no site file', undefined],
    ['an empty site file', (window) => { window.__ODV_SITE_CONFIG__ = {}; }],
    ['the sample site file', (window) => { window.eval(readFileSync('public/odv.site.config.sample.js', 'utf8')); }],
  ])('stays silent with %s: the shipped defaults never trigger a warning', (_name, prepare) => {
    const config = publish(prepare);
    expect(findOlderConfigNamesInUse(config)).toEqual([]);
    expect(warnAboutOlderConfigNames(config, warn)).toEqual([]);
    expect(warn).not.toHaveBeenCalled();
  });

  it('ignores values the readers do not accept, and anything that is not a configuration object', () => {
    const rejected = {
      logEndpoint: 5, logToken: null, logEnabled: 'yes', languageMode: null,
      print: { pdf: { orientation: { mode: '' }, orientationMode: 0 } },
    };
    expect(findOlderConfigNamesInUse(rejected)).toEqual([]);
    for (const value of [undefined, null, 'text', 7, []]) expect(findOlderConfigNamesInUse(value)).toEqual([]);
  });

  it.each([
    ['a getter on print that throws', () => Object.defineProperty({ logToken: SECRET }, 'print', {
      enumerable: true, get() { throw new Error('host getter'); },
    })],
    ['a getter on print.pdf that throws', () => ({
      logToken: SECRET,
      print: Object.defineProperty({}, 'pdf', { enumerable: true, get() { throw new Error('host getter'); } }),
    })],
    ['a getter on print.pdf.orientation that throws', () => ({
      logToken: SECRET,
      print: { pdf: Object.defineProperty({}, 'orientation', { enumerable: true, get() { throw new Error('host getter'); } }) },
    })],
  ])('never throws for a host configuration with %s, and still reports the names it can read', (_name, makeConfig) => {
    expect(() => findOlderConfigNamesInUse(makeConfig())).not.toThrow();
    expect(() => warnAboutOlderConfigNames(makeConfig(), warn)).not.toThrow();
    expect(findOlderConfigNamesInUse(makeConfig())).toEqual([{ older: 'logToken', documented: 'systemLog.token' }]);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['a Proxy that throws on every access', () => new Proxy({}, {
      get() { throw new Error('host proxy'); },
      has() { throw new Error('host proxy'); },
      ownKeys() { throw new Error('host proxy'); },
      getOwnPropertyDescriptor() { throw new Error('host proxy'); },
    })],
    ['a revoked Proxy', () => {
      const { proxy, revoke } = Proxy.revocable({}, {});
      revoke();
      return proxy;
    }],
  ])('never throws for %s and reports nothing', (_name, makeConfig) => {
    expect(() => findOlderConfigNamesInUse(makeConfig())).not.toThrow();
    expect(findOlderConfigNamesInUse(makeConfig())).toEqual([]);
    expect(() => warnAboutOlderConfigNames(makeConfig(), warn)).not.toThrow();
    expect(warnAboutOlderConfigNames(makeConfig(), warn)).toEqual([]);
    expect(warn).not.toHaveBeenCalled();
  });

  it('reports every older name of one site at once, each a single time', () => {
    const config = {
      logEndpoint: ENDPOINT, logToken: SECRET, logEnabled: false, languageMode: 'ignore', cacheLanguageMode: 'strict',
      print: { pdf: { orientation: { mode: 'auto' }, orientationMode: 'portrait' } },
    };
    warnAboutOlderConfigNames(config, warn);
    warnAboutOlderConfigNames(config, warn);
    expect(warn).toHaveBeenCalledTimes(7);
    expect(new Set(warn.mock.calls.map((call) => call[0])).size).toBe(7);
  });

  it('never warns outside a window, so a worker cannot repeat the warning', () => {
    vi.unstubAllGlobals();
    expect(typeof window).toBe('undefined');
    expect(warnAboutOlderConfigNames({ logToken: SECRET }, warn)).toEqual([]);
    expect(warn).not.toHaveBeenCalled();
  });
});

describe('older names: the precedence itself is unchanged', () => {
  it('lets the top-level log names win over systemLog.*', async () => {
    const config = publish((window) => {
      window.__ODV_SITE_CONFIG__ = {
        logEndpoint: '/older/log', logToken: 'older-token', logEnabled: false,
        systemLog: { endpoint: '/documented/log', token: 'documented-token', enabled: true },
      };
    });
    vi.stubGlobal('window', { __ODV_CONFIG__: config });
    const { readRuntimeConfig } = await import('../../logging/systemLogger.js');
    expect(readRuntimeConfig()).toEqual({ logEndpoint: '/older/log', logToken: 'older-token', logEnabled: false });

    vi.stubGlobal('window', { __ODV_CONFIG__: publish((window) => {
      window.__ODV_SITE_CONFIG__ = { systemLog: { endpoint: '/documented/log', token: 'documented-token', enabled: true } };
    }) });
    expect(readRuntimeConfig()).toEqual({ logEndpoint: '/documented/log', logToken: 'documented-token', logEnabled: true });
  });

  it('lets orientation.mode, then orientationMode, win over defaultAuto and fixedMode', () => {
    const orientationOf = (pdf) => {
      const config = publish((window) => {
        window.__ODV_SITE_CONFIG__ = { print: { pdf: { prebuildAllPages: { enabled: true }, ...pdf } } };
      });
      return createPdfPrebuildAllPagesVariants(config).variants[0].pdfOrientation;
    };
    const documented = { defaultAuto: false, fixedMode: 'portrait' };
    expect(orientationOf({ orientation: documented })).toBe('portrait');
    expect(orientationOf({ orientation: { ...documented, mode: 'landscape' } })).toBe('landscape');
    expect(orientationOf({ orientation: documented, orientationMode: 'landscape' })).toBe('landscape');
    expect(orientationOf({ orientation: { ...documented, mode: 'auto' }, orientationMode: 'landscape' })).toBe('auto');
  });

  it('lets the top-level languageMode, then cacheLanguageMode, win over print.pdf.cacheLanguageMode', () => {
    const modeOf = (site) => getPdfPrintCacheKeyOptions(publish((window) => { window.__ODV_SITE_CONFIG__ = site; })).languageMode;
    const documented = { print: { pdf: { cacheLanguageMode: 'ignore' } } };
    expect(modeOf(documented)).toBe('ignore');
    expect(modeOf({ ...documented, languageMode: 'strict' })).toBe('strict');
    expect(modeOf({ ...documented, cacheLanguageMode: 'strict' })).toBe('strict');
    expect(modeOf({ print: { pdf: { cacheLanguageMode: 'strict' } }, languageMode: 'ignore', cacheLanguageMode: 'strict' })).toBe('ignore');
  });
});

describe('older names: wiring', () => {
  it('is reported from the main-thread entry and from no worker', () => {
    const entry = readFileSync('src/index.jsx', 'utf8');
    expect(entry).toMatch(/import \{ warnAboutOlderConfigNames \} from '\.\/utils\/olderConfigNameWarnings\.js';/);
    expect(entry).toMatch(/warnAboutOlderConfigNames\(getRuntimeConfig\(\)\);/);
    for (const worker of ['pdfWorker.js', 'pdfPageWorker.js', 'imageWorker.js', 'pdfSignatureWorker.js']) {
      expect(readFileSync(`src/workers/${worker}`, 'utf8')).not.toContain('olderConfigNameWarnings');
    }
  });
});
