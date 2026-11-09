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
    'falls through a rejected-scheme %s base to the page folder',
    (baseHref) => {
      expect(resolveOdvBaseUrl({ baseHref })).toBe(`${origin}/OpenDocViewer/`);
      expect(resolveManualPageUrl({ baseHref })).toBe(`${origin}/OpenDocViewer/manual/`);
      expect(resolveManualPageUrl({ baseHref }, 'zoom')).toBe(`${origin}/OpenDocViewer/manual/#zoom`);
    },
  );

  it('falls through a rejected-scheme configured baseHref to the boot base', () => {
    window.__ODV_APP_BASE__ = 'https://viewer.example/odv/';
    expect(resolveOdvBaseUrl({ baseHref: 'javascript:alert(1)' })).toBe('https://viewer.example/odv/');
    expect(resolveManualPageUrl({ baseHref: 'javascript:alert(1)' })).toBe('https://viewer.example/odv/manual/');
  });

  it('falls through an unparseable configured baseHref to the boot base', () => {
    window.__ODV_APP_BASE__ = '/OpenDocViewer/';
    expect(resolveOdvBaseUrl({ baseHref: 'http://[' })).toBe(`${origin}/OpenDocViewer/`);
    expect(resolveManualPageUrl({ baseHref: 'http://[' })).toBe(`${origin}/OpenDocViewer/manual/`);
  });

  it('falls through two bad candidates to the page folder', () => {
    window.__ODV_APP_BASE__ = 'data:text/html,<p>x</p>';
    expect(resolveOdvBaseUrl({ baseHref: 'javascript:alert(1)' })).toBe(`${origin}/OpenDocViewer/`);
    expect(resolveManualPageUrl({ baseHref: 'javascript:alert(1)' }, 'zoom'))
      .toBe(`${origin}/OpenDocViewer/manual/#zoom`);
  });
});
