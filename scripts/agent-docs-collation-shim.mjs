// Preloaded (node --import, through NODE_OPTIONS) into the AgentDocMap process
// and its nested Node processes by scripts/generate-agent-docs.mjs.
//
// AgentDocMap sorts paths and names with String.prototype.localeCompare() and
// no locale argument, so its output follows the OS default collation (sv-SE on
// a Swedish Windows desktop, en-US on a C.UTF-8 Linux runner). On Windows the
// default comes from the OS and cannot be overridden through LANG/LC_ALL, so
// this shim pins it instead: localeCompare() calls WITHOUT an explicit locale
// use the pinned locale. Calls that pass a locale are left untouched.
//
// After installing, the shim sorts the pin's probe with plain localeCompare()
// and refuses to continue unless the result equals the pinned expected order.
// That rejects an unsupported locale, a different ICU collation and a shim that
// did not take effect.

const variable = 'ODV_AGENT_DOCS_COLLATION';
const raw = process.env[variable];
if (!raw) {
  throw new Error(`${variable} is not set; the collation shim must be loaded by scripts/generate-agent-docs.mjs.`);
}

const { locale, probe, expectedOrder } = JSON.parse(raw);
// Without data for the locale, Intl silently falls back to the OS default.
if (Intl.Collator.supportedLocalesOf([locale]).length !== 1) {
  throw new Error(
    `Pinned collation locale ${locale} is not available in Node ${process.version} (ICU ${process.versions.icu}); ` +
      `it would fall back to ${new Intl.Collator(locale).resolvedOptions().locale}.`,
  );
}

const pinnedCollator = new Intl.Collator(locale);
const originalLocaleCompare = String.prototype.localeCompare;

Object.defineProperty(String.prototype, 'localeCompare', {
  configurable: true,
  enumerable: false,
  writable: true,
  value: function localeCompare(that, locales, options) {
    if (this === null || this === undefined) {
      return originalLocaleCompare.call(this, that, locales, options);
    }
    if (locales !== undefined) {
      return originalLocaleCompare.call(this, that, locales, options);
    }
    const collator = options === undefined ? pinnedCollator : new Intl.Collator(locale, options);
    return collator.compare(String(this), String(that));
  },
});

const actualOrder = [...probe].sort((left, right) => left.localeCompare(right));
if (actualOrder.join('\u0000') !== expectedOrder.join('\u0000')) {
  throw new Error(
    `Effective collation does not match the pin (locale ${locale}, Node ${process.version}, ICU ${process.versions.icu}).\n` +
      `  expected: ${expectedOrder.join(' ')}\n` +
      `  actual:   ${actualOrder.join(' ')}\n` +
      'Update collation.expectedOrder in scripts/agent-docs-environment.json only after confirming the new order is intended.',
  );
}
