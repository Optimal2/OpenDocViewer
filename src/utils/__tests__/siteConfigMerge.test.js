import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { afterEach, expect, it, vi } from 'vitest';
import { getDocumentLoadingConfig } from '../documentLoadingConfig.js';
import {
  isCompareCurtainEnabled,
  isCompareCurtainPrintEnabled,
  isCompareOverlayEnabled,
  isCompareOverlayPrintEnabled,
  getCompareAdjustToolbarMode,
  getViewerCustomFitWidthFactorPercent,
  getPrintDefaultMode,
  getPrintSelectionWorkspaceConfig,
  getViewerEdgeScrollPageTurnConfig,
} from '../runtimeConfig.js';

afterEach(() => vi.unstubAllGlobals());

it.each(['__proto__', 'constructor', 'prototype'])('ignores the reserved site key %s at every merge depth', (key) => {
  const dom = new JSDOM('<!doctype html>', { runScripts: 'outside-only' });
  try {
    const { window } = dom;
    const source = readFileSync('public/odv.config.js', 'utf8');
    const prototypeBefore = Object.getOwnPropertyDescriptors(window.Object.prototype);
    window.__ODV_SITE_CONFIG__ = window.JSON.parse(JSON.stringify({
      [key]: 'ignored',
      compare: { [key]: 'ignored', adjust: { toolbarMode: 'hide' } },
      viewer: { printSelectionWorkspace: { [key]: 'ignored', enabled: false } },
      siteExtension: { nested: [{ [key]: 'ignored', enabled: true }] },
    }));
    window.eval(source);

    const config = window.__ODV_CONFIG__;
    const fresh = window.eval('({})');
    expect(Object.getOwnPropertyDescriptors(Object.getPrototypeOf(fresh))).toEqual(prototypeBefore);
    for (const object of [config, config.compare, config.viewer.printSelectionWorkspace,
      config.print.selectionWorkspace, config.siteExtension.nested[0]]) {
      expect(Object.getPrototypeOf(object)).toBe(window.Object.prototype);
      expect(Object.getOwnPropertyNames(object)).not.toContain(key);
    }
    expect(config.compare.adjust).toEqual({ toolbarMode: 'hide' });
    expect(config.print.selectionWorkspace.enabled).toBe(false);
    expect(config.siteExtension).toEqual({ nested: [{ enabled: true }] });
  } finally {
    dom.window.close();
  }
});

it.each(['self reference', 'array element referencing an ancestor'])('publishes a sanitized site configuration (%s)', (kind) => {
  const dom = new JSDOM('<!doctype html>', { runScripts: 'outside-only' });
  try {
    const { window } = dom;
    const source = readFileSync('public/odv.config.js', 'utf8');
    const prototypeBefore = Object.getOwnPropertyDescriptors(window.Object.prototype);
    const extension = window.JSON.parse('{"enabled":true,"__proto__":"ignored","constructor":"ignored","prototype":"ignored"}');
    const clean = { label: 'site' };
    const site = { compare: { adjust: { toolbarMode: 'hide' } }, siteExtension: extension, clean };
    if (kind === 'self reference') {
      site.self = site;
    } else {
      extension.items = [extension, { label: 'item' }];
    }
    window.__ODV_SITE_CONFIG__ = site;

    expect(() => window.eval(source)).not.toThrow();

    const config = window.__ODV_CONFIG__;
    expect(config.compare.adjust.toolbarMode).toBe('hide');
    expect(config.clean).toBe(clean);
    expect(config.siteExtension.enabled).toBe(true);
    for (const key of ['__proto__', 'constructor', 'prototype']) {
      expect(Object.hasOwn(config.siteExtension, key)).toBe(false);
      expect(Object.hasOwn(extension, key)).toBe(true);
    }
    expect(Object.getPrototypeOf(config.siteExtension)).toBe(window.Object.prototype);
    expect(Object.getOwnPropertyDescriptors(window.Object.prototype)).toEqual(prototypeBefore);
    if (kind === 'self reference') {
      expect(config.self.self).toBe(config.self);
      expect(config.self.siteExtension).toBe(config.siteExtension);
    } else {
      expect(config.siteExtension.items[0]).toBe(config.siteExtension);
      expect(config.siteExtension.items[1].label).toBe('item');
    }
  } finally {
    dom.window.close();
  }
});

it('publishes a deeply nested site configuration with its reserved keys removed', () => {
  const dom = new JSDOM('<!doctype html>', { runScripts: 'outside-only' });
  try {
    let extension = { enabled: true, prototype: 'ignored' };
    const depth = 12000;
    for (let i = 0; i < depth; i += 1) extension = { child: extension };
    dom.window.__ODV_SITE_CONFIG__ = { siteExtension: extension };

    dom.window.eval(readFileSync('public/odv.config.js', 'utf8'));

    let leaf = dom.window.__ODV_CONFIG__.siteExtension;
    for (let i = 0; i < depth; i += 1) leaf = leaf.child;
    expect(leaf.enabled).toBe(true);
    expect(Object.hasOwn(leaf, 'prototype')).toBe(false);
  } finally {
    dom.window.close();
  }
});

it('merges valid nested overrides, replacement arrays and a legacy alias over the defaults', () => {
  const source = readFileSync('public/odv.config.js', 'utf8');
  const read = (siteConfig) => {
    const dom = new JSDOM('<!doctype html>', { runScripts: 'outside-only' });
    try {
      dom.window.__ODV_SITE_CONFIG__ = siteConfig;
      dom.window.eval(source);
      return dom.window.__ODV_CONFIG__;
    } finally {
      dom.window.close();
    }
  };

  const base = read({});
  const languages = ['swe', 'eng'];
  const config = read({
    compare: { overlay: { print: { enabled: false } } },
    ocr: { languages },
    viewer: { customFitWidthPercent: 55 },
  });
  expect(config).toEqual({
    ...base,
    compare: { ...base.compare, overlay: { ...base.compare.overlay, print: { enabled: false } } },
    ocr: { ...base.ocr, languages: ['swe', 'eng'] },
    viewer: { ...base.viewer, customFitWidthPercent: 55, customFitWidthFactorPercent: 55 },
  });
  expect(config.ocr.languages).toBe(languages);
});

it('preserves valid configuration identity and reads or creates ordinary paths', () => {
  const dom = new JSDOM('<!doctype html>', { runScripts: 'outside-only' });
  try {
    // Return the private helpers from the test copy of the script.
    const source = readFileSync('public/odv.config.js', 'utf8').replace(
      '})(window, document);',
      '  return { readConfigPath, writeConfigPath, stripReservedConfigKeys };\n})(window, document);',
    );
    const { readConfigPath, writeConfigPath, stripReservedConfigKeys } = dom.window.eval(source);
    const overlay = { enabled: false, print: { enabled: true } };
    const site = { compare: { overlay }, ocr: { languages: ['swe', 'eng'] } };

    expect(stripReservedConfigKeys(site)).toBe(site);
    const cyclic = {};
    cyclic.self = cyclic;
    expect(stripReservedConfigKeys(cyclic)).toBe(cyclic);
    expect(readConfigPath(site, 'compare.overlay.enabled')).toBe(false);
    expect(readConfigPath(site, 'compare.curtain.enabled')).toBeUndefined();
    expect(readConfigPath(site, 'compare.overlay.enabled.nested')).toBeUndefined();

    writeConfigPath(site, 'compare.overlay.enabled', true);
    writeConfigPath(site, 'compare.curtain.print.enabled', false);

    expect(site.compare.overlay).toBe(overlay);
    expect(site.compare.overlay).toEqual({ enabled: true, print: { enabled: true } });
    expect(site.compare.curtain).toEqual({ print: { enabled: false } });
    expect(readConfigPath(site, 'compare.curtain.print.enabled')).toBe(false);
  } finally {
    dom.window.close();
  }
});

it('preserves the site fullPageScale through the public script and render normalization', () => {
  const dom = new JSDOM('<!doctype html>', { runScripts: 'outside-only' });
  try {
    dom.window.__ODV_SITE_CONFIG__ = { documentLoading: { render: { fullPageScale: 4 } } };
    dom.window.eval(readFileSync('public/odv.config.js', 'utf8'));
    vi.stubGlobal('window', dom.window);
    // Use the same default runtime-config read as ViewerProvider and PageAssetRenderer.
    const render = getDocumentLoadingConfig().render;
    expect(render.fullPageScale).toBe(4);
    expect(render.pdfResolution.fixedScale).toBe(4);
    expect(dom.window.__ODV_SITE_CONFIG_KEYS__).toEqual(['documentLoading']);
  } finally {
    dom.window.close();
  }
});

it('lets an explicit nested fixedScale take precedence and normalizes invalid site values', () => {
  for (const [fixedScale, expected] of [[3, 3], ['garbage', 2]]) {
    const dom = new JSDOM('<!doctype html>', { runScripts: 'outside-only' });
    try {
      dom.window.__ODV_SITE_CONFIG__ = {
        documentLoading: { render: { fullPageScale: 4, pdfResolution: { mode: 'fixed', fixedScale } } },
      };
      dom.window.eval(readFileSync('public/odv.config.js', 'utf8'));
      vi.stubGlobal('window', dom.window);
      const render = getDocumentLoadingConfig().render;
      expect(render.pdfResolution.fixedScale).toBe(expected);
      expect(render.fullPageScale).toBe(expected);
    } finally {
      dom.window.close();
    }
  }
});

it('keeps the compare view switches on by default and deep-merges a single site override', () => {
  const read = (siteConfig) => {
    const dom = new JSDOM('<!doctype html>', { runScripts: 'outside-only' });
    try {
      if (siteConfig) dom.window.__ODV_SITE_CONFIG__ = siteConfig;
      dom.window.eval(readFileSync('public/odv.config.js', 'utf8'));
      vi.stubGlobal('window', dom.window);
      return {
        compare: dom.window.__ODV_CONFIG__.compare,
        overlay: isCompareOverlayEnabled(),
        overlayPrint: isCompareOverlayPrintEnabled(),
        curtain: isCompareCurtainEnabled(),
        curtainPrint: isCompareCurtainPrintEnabled(),
      };
    } finally {
      dom.window.close();
    }
  };

  const base = read(null);
  expect(base.compare).toEqual({
    overlay: { enabled: true, print: { enabled: true } },
    curtain: { enabled: true, print: { enabled: true } },
    adjust: { toolbarMode: 'mirror' },
  });
  expect(base).toMatchObject({ overlay: true, overlayPrint: true, curtain: true, curtainPrint: true });

  const site = read({ compare: { overlay: { print: { enabled: false } } } });
  expect(site).toMatchObject({ overlay: true, overlayPrint: false, curtain: true, curtainPrint: true });
});

it('ships toolbarMode mirror and deep-merges a site file that sets only compare.adjust.toolbarMode', () => {
  const read = (siteConfig) => {
    const dom = new JSDOM('<!doctype html>', { runScripts: 'outside-only' });
    try {
      if (siteConfig) dom.window.__ODV_SITE_CONFIG__ = siteConfig;
      dom.window.eval(readFileSync('public/odv.config.js', 'utf8'));
      vi.stubGlobal('window', dom.window);
      return {
        compare: JSON.parse(JSON.stringify(dom.window.__ODV_CONFIG__.compare)),
        toolbarMode: getCompareAdjustToolbarMode(),
        overlay: isCompareOverlayEnabled(),
        curtain: isCompareCurtainEnabled(),
      };
    } finally {
      dom.window.close();
    }
  };

  expect(read(null).toolbarMode).toBe('mirror');

  const site = read({ compare: { adjust: { toolbarMode: 'hide' } } });
  // The site override wins over the shipped default ...
  expect(site.toolbarMode).toBe('hide');
  // ... and the sibling compare keys survive untouched.
  expect(site.compare).toEqual({
    overlay: { enabled: true, print: { enabled: true } },
    curtain: { enabled: true, print: { enabled: true } },
    adjust: { toolbarMode: 'hide' },
  });
  expect(site).toMatchObject({ overlay: true, curtain: true });

  // A site file that switches a view off keeps the shipped toolbarMode.
  const viewOff = read({ compare: { curtain: { enabled: false } } });
  expect(viewOff.toolbarMode).toBe('mirror');
  expect(viewOff.compare.adjust).toEqual({ toolbarMode: 'mirror' });

  // An invalid site value is kept in the merged config but read back fail-safe.
  expect(read({ compare: { adjust: { toolbarMode: 'Hidden' } } }).toolbarMode).toBe('mirror');
});


it('promotes legacy site-only aliases before merged defaults can mask them', () => {
  const dom = new JSDOM('<!doctype html>', { runScripts: 'outside-only' });
  try {
    dom.window.__ODV_SITE_CONFIG__ = {
      viewer: {
        customFitWidthPercent: 55,
        printSelectionWorkspace: {
          enabled: false,
          headerTemplate: 'legacy header',
          lightboxInfoTemplate: 'legacy preview',
        },
      },
      print: { defaultPrintMode: 'all' },
      edgeScrollPageTurn: false,
      documentLoading: { render: {
        'pdf-to-image-mode': 'worker',
        maxPdfWorkerCount: 5,
        pdfWorkerAutoPolicy: { mainThreadBelowCores: 3 },
      } },
    };
    dom.window.eval(readFileSync('public/odv.config.js', 'utf8'));
    vi.stubGlobal('window', dom.window);

    expect(getViewerCustomFitWidthFactorPercent()).toBe(55);
    expect(getPrintDefaultMode()).toBe('all');
    expect(getPrintSelectionWorkspaceConfig()).toEqual({
      enabled: false,
      documentHeaderTemplate: 'legacy header',
      previewInfoTemplate: 'legacy preview',
    });
    expect(getViewerEdgeScrollPageTurnConfig().enabled).toBe(false);
    const render = getDocumentLoadingConfig().render;
    expect(render.pdfToImageMode).toBe('worker');
    expect(render.pdfWorkerMaxCount).toBe(5);
    expect(render.pdfWorkerPagePolicy.mainThreadBelowHardwareConcurrency).toBe(3);
  } finally {
    dom.window.close();
  }
});

it('keeps an explicit canonical site value ahead of its legacy alias', () => {
  const dom = new JSDOM('<!doctype html>', { runScripts: 'outside-only' });
  try {
    dom.window.__ODV_SITE_CONFIG__ = {
      viewer: { customFitWidthFactorPercent: 65, customFitWidthPercent: 55 },
      print: { defaultPageMode: 'active', defaultPrintMode: 'all' },
    };
    dom.window.eval(readFileSync('public/odv.config.js', 'utf8'));
    vi.stubGlobal('window', dom.window);
    expect(getViewerCustomFitWidthFactorPercent()).toBe(65);
    expect(getPrintDefaultMode()).toBe('active');
  } finally {
    dom.window.close();
  }
});

// The published configuration must give the readers the same answer as the site file alone
// would: the canonical name first, the older name only when the canonical one is absent.
const readPublished = (siteConfig, read) => {
  const dom = new JSDOM('<!doctype html>', { runScripts: 'outside-only' });
  try {
    dom.window.__ODV_SITE_CONFIG__ = siteConfig;
    dom.window.eval(readFileSync('public/odv.config.js', 'utf8'));
    vi.stubGlobal('window', dom.window);
    return read(dom.window.__ODV_CONFIG__);
  } finally {
    dom.window.close();
  }
};
const readThreshold = (render) => readPublished(
  { documentLoading: { render } },
  () => getDocumentLoadingConfig().render.pdfWorkerPagePolicy.mainThreadBelowHardwareConcurrency,
);

it.each([
  ['the canonical policy object beats a left-over older policy object',
    { pdfWorkerPagePolicy: { mainThreadBelowCores: 2 }, pdfWorkerAutoPolicy: { mainThreadBelowCores: 6 } }, 2],
  ['a canonical policy object without the threshold hides the older object entirely',
    { pdfWorkerPagePolicy: { enabled: true }, pdfWorkerAutoPolicy: { mainThreadBelowCores: 6 } }, 0],
  ['the canonical key beats the older key inside the canonical object',
    { pdfWorkerPagePolicy: { mainThreadBelowHardwareConcurrency: 4, mainThreadBelowCores: 2 } }, 4],
  ['the canonical key beats the older key inside the older object',
    { pdfWorkerAutoPolicy: { mainThreadBelowHardwareConcurrency: 4, mainThreadBelowCores: 2 } }, 4],
  ['the canonical object beats the older object even when both carry the canonical key',
    { pdfWorkerPagePolicy: { mainThreadBelowHardwareConcurrency: 1 },
      pdfWorkerAutoPolicy: { mainThreadBelowHardwareConcurrency: 5, mainThreadBelowCores: 6 } }, 1],
  ['the older key in the older object still works on its own',
    { pdfWorkerAutoPolicy: { mainThreadBelowCores: 3 } }, 3],
  ['the older key in the canonical object still works on its own',
    { pdfWorkerPagePolicy: { mainThreadBelowCores: 3 } }, 3],
])('PDF worker policy: %s', (_name, render, expected) => {
  expect(readThreshold(render)).toBe(expected);
});

it('ignores viewer.printSelectionWorkspace entirely when the site has print.selectionWorkspace', () => {
  const site = {
    print: { selectionWorkspace: { enabled: true } },
    viewer: { printSelectionWorkspace: { enabled: false, headerTemplate: 'OLD', lightboxInfoTemplate: 'OLD' } },
  };
  const published = readPublished(site, (config) => ({
    workspace: JSON.parse(JSON.stringify(config.print.selectionWorkspace)),
    read: getPrintSelectionWorkspaceConfig(),
  }));
  const defaults = readPublished({}, (config) => JSON.parse(JSON.stringify(config.print.selectionWorkspace)));
  expect(published.workspace).toEqual(defaults);
  expect(published.read.enabled).toBe(true);
  expect(published.read.documentHeaderTemplate).toEqual(defaults.documentHeaderTemplate);
  expect(published.read.previewInfoTemplate).toEqual(defaults.previewInfoTemplate);
});

it.each(['print.selectionWorkspace', 'viewer.printSelectionWorkspace'])(
  'keeps the canonical template names ahead of the older names inside %s',
  (path) => {
    const workspace = {
      documentHeaderTemplate: 'NEW header', headerTemplate: 'OLD header',
      previewInfoTemplate: 'NEW preview', lightboxInfoTemplate: 'OLD preview',
    };
    const site = path === 'print.selectionWorkspace'
      ? { print: { selectionWorkspace: workspace } }
      : { viewer: { printSelectionWorkspace: workspace } };
    expect(readPublished(site, () => getPrintSelectionWorkspaceConfig())).toEqual({
      enabled: true,
      documentHeaderTemplate: 'NEW header',
      previewInfoTemplate: 'NEW preview',
    });
    // The site file alone gives the reader the same answer.
    expect(getPrintSelectionWorkspaceConfig(site)).toMatchObject({
      documentHeaderTemplate: 'NEW header',
      previewInfoTemplate: 'NEW preview',
    });
  },
);

it('orders the older print default names the way the reader does', () => {
  const site = { print: { defaultPrintMode: 'all' }, viewer: { print: { defaultPageMode: 'active' } } };
  expect(readPublished(site, () => getPrintDefaultMode())).toBe('all');
  expect(getPrintDefaultMode(site)).toBe('all');
  expect(readPublished({ viewer: { print: { defaultPageMode: 'all' } } }, () => getPrintDefaultMode())).toBe('all');
});

it('treats a canonical site value of null as absent, as the readers do', () => {
  const site = { viewer: { customFitWidthFactorPercent: null, customFitWidthPercent: 55 } };
  expect(readPublished(site, () => getViewerCustomFitWidthFactorPercent())).toBe(55);
  expect(getViewerCustomFitWidthFactorPercent(site)).toBe(55);
});

it('publishes a configuration whose older and canonical names share a cyclic object', () => {
  const cyclic = { en: 'header' };
  cyclic.self = cyclic;
  const site = {
    print: { selectionWorkspace: { headerTemplate: cyclic } },
    viewer: { printSelectionWorkspace: { headerTemplate: cyclic } },
  };
  // Like any site object, the template is merged over the shipped localized default.
  const template = readPublished(site, (config) => config.print.selectionWorkspace.documentHeaderTemplate);
  expect(template.en).toBe('header');
  expect(template.self).toBe(cyclic);
});

it('merges two cyclic objects without unbounded recursion and keeps the cycle', () => {
  const dom = new JSDOM('<!doctype html>', { runScripts: 'outside-only' });
  try {
    const source = readFileSync('public/odv.config.js', 'utf8').replace(
      '})(window, document);',
      '  return { deepMerge };\n})(window, document);',
    );
    const { deepMerge } = dom.window.eval(source);
    const left = { name: 'left', only: { left: true } };
    left.self = left;
    left.peer = { back: left };
    const right = { name: 'right' };
    right.self = right;
    right.peer = { back: right };

    const out = deepMerge(left, right);

    expect(out.name).toBe('right');
    expect(out.only).toEqual({ left: true });
    expect(out.self).toBe(out);
    expect(out.peer.back).toBe(out);
    expect(left.self).toBe(left);
    expect(right.self).toBe(right);
  } finally {
    dom.window.close();
  }
});

// Plain reference merge: objects merge key by key, everything else is replaced by the site value.
const referenceMerge = (defaults, site) => {
  const isPlain = (value) => value && typeof value === 'object' && !Array.isArray(value);
  if (!isPlain(site)) return site === undefined ? defaults : site;
  const out = { ...(isPlain(defaults) ? defaults : {}) };
  for (const key of Object.keys(site)) out[key] = referenceMerge(isPlain(defaults) ? defaults[key] : undefined, site[key]);
  return out;
};
const publish = (prepare) => {
  const dom = new JSDOM('<!doctype html>', { runScripts: 'outside-only' });
  try {
    prepare?.(dom.window);
    const site = dom.window.__ODV_SITE_CONFIG__;
    dom.window.eval(readFileSync('public/odv.config.js', 'utf8'));
    return { config: dom.window.__ODV_CONFIG__, site };
  } finally {
    dom.window.close();
  }
};

it.each([
  ['no site file', undefined],
  ['an empty site file', (window) => { window.__ODV_SITE_CONFIG__ = {}; }],
  ['the sample site file', (window) => { window.eval(readFileSync('public/odv.site.config.sample.js', 'utf8')); }],
])('leaves the configuration exactly as the plain merge gives it with %s', (_name, prepare) => {
  const defaults = publish().config;
  const { config, site } = publish(prepare);
  if (prepare && _name === 'the sample site file') expect(Object.keys(site).length).toBeGreaterThan(3);
  // No promotion step may add, move or change anything for a site file without older names.
  expect(config).toEqual(referenceMerge(defaults, site ?? {}));
});

it.each([
  ['print.selectionWorkspace', () => ({
    print: { selectionWorkspace: null },
    viewer: { printSelectionWorkspace: { enabled: false, headerTemplate: 'OLD header', nested: { keep: true } } },
  })],
  ['pdfWorkerPagePolicy', () => ({
    documentLoading: { render: { pdfWorkerPagePolicy: null, pdfWorkerAutoPolicy: { mainThreadBelowCores: 3 } } },
  })],
])('never writes a promoted value into the site object (%s: null with an older object)', (_name, makeSite) => {
  const { config, site } = publish((window) => { window.__ODV_SITE_CONFIG__ = makeSite(); });
  expect(site).toEqual(makeSite());
  if (_name === 'print.selectionWorkspace') {
    expect(config.print.selectionWorkspace).not.toBe(site.viewer.printSelectionWorkspace);
    expect(config.print.selectionWorkspace).toMatchObject({ enabled: false, documentHeaderTemplate: 'OLD header' });
  } else {
    expect(config.documentLoading.render.pdfWorkerPagePolicy).not.toBe(site.documentLoading.render.pdfWorkerAutoPolicy);
    expect(config.documentLoading.render.pdfWorkerPagePolicy.mainThreadBelowHardwareConcurrency).toBe(3);
  }
});
