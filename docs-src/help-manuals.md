# Bundled help manuals: source and build chain

`public/help/default/` ships the user manual that the help menu shows when a deployment has no
manual of its own under `help/site/` (resolution order and the `help.manual` config keys are in
`docs-src/runtime-configuration.md`). This note explains where those files come from and why they
are never edited in this repository.

## What is generated

Everything under `public/help/default/` is a **generated copy**:

- `manual.<lng>.html` — the getting-started guide; the other guides are embedded at the bottom of
  it as collapsed sections, with their ids prefixed so that nothing collides
- `manual-<guide>.<lng>.html` — each further guide as a page of its own
  (`manual-urval` selection, `manual-jamforelse` comparison, `manual-avancerat` more features)
- `manual*.<lng>.pdf` — a PDF of every guide, printed from the HTML
- `img/` — the screenshots, one set shared by both languages

`<lng>` is `sv` or `en`; the Swedish and English texts are kept in lockstep.

The sources — the hand-written HTML per guide and language, the screenshots, and the scripts that
build the copies — live in a **private repository** together with customer-specific editions of
the same manual. The public copy is customer-neutral: a made-up test document, no organisation,
environment or support contact.

## How the chain works

The build in the source repository, in order:

1. **Embed.** A script copies the master CSS block of `manual.<lng>.html` into the other guides,
   builds the script-free image lightboxes, injects the search box, builds the side navigation and
   embeds each further guide between `<!-- EMBED-START … -->` / `<!-- EMBED-END … -->` markers in
   `manual.<lng>.html`. The script is idempotent: running it twice gives the same files.
2. **Word.** A Python script (python-docx) converts each guide to `.docx`; the Word files stay in the
   source repository and are not shipped here.
3. **PDF.** Headless Microsoft Edge prints a temporary copy of each guide in which every
   `<details>` is expanded, the embedded guides and the lightboxes are stripped (they have PDFs of
   their own), and every relative link to another guide is dropped — the link text stays, but a
   relative `href` would otherwise be resolved against the temporary file's `file:///` URI and
   written into the PDF as an absolute path on the build machine.
4. **Gate.** Every produced PDF is scanned for `file:///` link annotations (PyMuPDF); one hit makes
   the build fail. A text-only sensitivity sweep runs separately, because PDF text and PDF link
   annotations are different layers.
5. **Copy.** `manual*.<lng>.html`, `manual*.<lng>.pdf` and `img/` are copied into
   `public/help/default/`, the Validation Ladder runs here, `opendocviewer-web` in
   `omp-components.json` is bumped, and the commit is swept before it is pushed.

**The file name pattern decides what is built.** Every `manual.<lng>.html` and
`manual-<guide>.<lng>.html` in the source folder is built and copied — `manual`, `manual-urval`,
`manual-jamforelse`, `manual-avancerat`, one hyphen at most in the guide name, two-letter language
code. A guide that is only embedded, or only standalone, does not exist: each one is both.

## Rules for this repository

- **Never hand-edit `public/help/default/*.html`, `*.pdf` or `img/`.** A fix made here is
  overwritten by the next copy from the source. Change the source, rebuild, copy.
- A deployment that wants other wording puts its own `help/site/manual.<lng>.html` next to the
  bundled files; it wins and survives upgrades (`docs-src/runtime-configuration.md`).
- The copies carry the search-box script and the side navigation of the standalone page. The
  in-app manual window strips scripts (DOMPurify) and builds its own contents tree and search; the
  side navigation is hidden by the manual's own CSS unless the HTML is opened as a page of its own.

## What pins the content here

- `src/__tests__/compareHelp.test.js` — the comparison guide (`manual-jamforelse.<lng>.html`, its
  embedded copy in `manual.<lng>.html` with the `jmf-` prefix, and its PDF) carries a section per
  compare view, the composed-print paragraphs and every site switch; the in-app help entries match
  the UI labels.
- `src/utils/__tests__/manualSources.test.js` — `help/site/` before `help/default/`, sample files
  are never candidates.
- `tests/ui/manual-contents-tree.spec.mjs` — the bundled Swedish manual opens its lightboxes through
  the URL fragment inside the manual window.
