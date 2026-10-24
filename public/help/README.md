# help/

- `default/` — the bundled user manual (Swedish and English): `manual.<lng>.html` with the other
  guides embedded, `manual-<guide>.<lng>.html` as pages of their own, a PDF of each guide and the
  screenshots in `img/`. **Generated copies — do not edit them here.** The sources and the build
  (embed, PDF print, link gate) live in a private repository; every file whose name matches
  `manual(-<guide>)?.<lng>.html` there is built and copied here. See `docs-src/help-manuals.md`.
- `site/` — the deployment's own manual: `manual.<lng>.html` placed here wins over `default/` and
  survives upgrades. The `*.sample.html` files are templates and are never shown.
