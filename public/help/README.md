# help/

- `default/` — the bundled user manual (Swedish and English): `manual.<lng>.html` with the other
  guides embedded, `manual-<guide>.<lng>.html` as pages of their own, a complete PDF of each guide
  and the screenshots in `img/`. **Generated copies — do not edit them here.** The sources and the
  build (embed, PDF print, link gate) live in a private repository; every file whose name matches
  `manual(-<guide>)?.<lng>.html` there is built and copied here. See `docs-src/help-manuals.md`.
- `site/` — the deployment's own manual: with `help.manual.source: 'auto'` (the default),
  `manual.<lng>.html` placed here wins over `default/` and survives upgrades. The `*.sample.html`
  files are templates and are never shown. Site-owned HTML is never feature-filtered.
- `help.manual.source: 'standard'` ignores site HTML and lazy-loads a generated module from the
  unchanged default combined manual. Runtime feature switches filter its interactive HTML before
  contents/search/lightbox processing; a chunk failure uses `fallbackPathTemplate` with the same
  filtering. Images resolve from `default/img/`, and the complete PDFs are not filtered. The
  JavaScript modules are generated at build/test time and are not committed manual sources.
- The same manuals are also readable as a page of their own at `<ODV base>/manual/` (with the
  section as the `#<section>` fragment). The page follows the same `help.manual` configuration;
  `help.manual.enabled: false` hides the help menu's Manual entry and makes the page report that
  the manual is not available. See `docs-src/help-manuals.md`.
