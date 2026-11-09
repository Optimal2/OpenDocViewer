// @vitest-environment jsdom
// File: src/components/Manual/__tests__/manualDocument.baseUrl.test.js
//
// The ODV base URL is a folder: a runtime config `baseHref` without its trailing slash must still
// put the stand-alone manual page (and manual files) inside that folder, and a base that is not a
// web URL (javascript:, data:) must never end up in an href.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resolveManualPageUrl, resolveOdvBaseUrl } from '../manualDocument.js';

describe('ODV base and manual page URL', () => {
  let initialUrl;
  let origin;

  beforeEach(() => {
    initialUrl = window.location.href;
    origin = window.location.origin;
    window.history.replaceState(null, '', '/OpenDocViewer/');
  });

  afterEach(() => {
    delete window.__ODV_APP_BASE__;
    window.history.replaceState(null, '', initialUrl);
  });

  it('adds the missing trailing slash to a configured baseHref', () => {
    expect(resolveOdvBaseUrl({ baseHref: '/OpenDocViewer' })).toBe(`${origin}/OpenDocViewer/`);
    expect(resolveManualPageUrl({ baseHref: '/OpenDocViewer' })).toBe(`${origin}/OpenDocViewer/manual/`);
    expect(resolveManualPageUrl({ baseHref: 'https://viewer.example/odv' }, 'zoom'))
      .toBe('https://viewer.example/odv/manual/#zoom');
  });

  it('adds the missing trailing slash to the base bootConfig derived', () => {
    window.__ODV_APP_BASE__ = '/OpenDocViewer';
    expect(resolveManualPageUrl({})).toBe(`${origin}/OpenDocViewer/manual/`);
  });

  it('leaves a base that already ends with a slash as it is', () => {
    expect(resolveOdvBaseUrl({ baseHref: '/OpenDocViewer/' })).toBe(`${origin}/OpenDocViewer/`);
    expect(resolveManualPageUrl({ baseHref: '/OpenDocViewer/' }, 'a b')).toBe(`${origin}/OpenDocViewer/manual/#a%20b`);
  });

  it.each(['javascript:alert(1)', 'data:text/html,<p>x</p>'])(
    'falls back to the relative manual path for a %s base',
    (baseHref) => {
      expect(resolveOdvBaseUrl({ baseHref })).toBeUndefined();
      expect(resolveManualPageUrl({ baseHref })).toBe('manual/');
      expect(resolveManualPageUrl({ baseHref }, 'zoom')).toBe('manual/#zoom');
    },
  );
});
