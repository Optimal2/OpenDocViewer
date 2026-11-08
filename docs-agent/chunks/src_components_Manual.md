# OpenDocViewer / src/components/Manual

File count: 4. Line count: 1533. JSDoc symbol count: 44.

## src/components/Manual/manualDocument.js

Manual source loading and HTML preparation shared by every manual host \(the overlay dialog and a full\-page view\).

Exports: `loadManualDocument`

Local imports: `src/utils/manualSources.js`, `src/utils/standardManual.js`, `src/generated/standard-manual/manual.sv.js`, `src/generated/standard-manual/manual.en.js`

Symbols:

- `absoluteManualUrl` (function) - No description.
- `copyManualConfig` (function) - Copy only settings used by the selected source.
- `loadStandardManual` (function) - Load the preferred generated standard manual.
- `loadAutoManual` (function) - Resolve auto mode per language: site HTML first, then generated standard content or its emergency HTML fallback.
- `isRewritableRelativeUrl` (function) - No description.
- `rewriteManualSrcset` (function) - Rewrite the URL in each srcset candidate while retaining its width or density descriptor.
- `sanitizeManualHtml` (function) - No description.
- `rewriteManualHtml` (function) - No description.
- `appendManualRefreshToken` (function) - No description.
- `removeManualRefreshToken` (function) - No description.
- `loadManualDocument` (function) - Load the manual for one UI language exactly as the configured source mode prescribes, apply feature filtering to standard content and return sanitised HTML ready for rendering.

## src/components/Manual/manualNavigation.js

Scrolling, focus and URL\-fragment helpers for navigating inside a rendered manual.

Exports: `MANUAL_SECTION_ACTIVE_LINE`, `MANUAL_SECTION_SCROLL_GAP`, `openDetailsAncestors`, `scrollPaneToTarget`, `findManualElementById`, `isHiddenInManual`, `captureScrollPositions`, `replaceUrlFragment`

Symbols:

- `MANUAL_SECTION_ACTIVE_LINE` (constant) - Share of the content pane height, measured from its top, inside which a heading counts as the start of the section being read.
- `MANUAL_SECTION_SCROLL_GAP` (constant) - Gap in pixels kept above a heading when the content pane scrolls to it.
- `openDetailsAncestors` (function) - Open collapsed &lt;details&gt; ancestors so a target inside them can be shown.
- `scrollPaneToTarget` (function) - Scroll only the given pane so the target sits at its top.
- `findManualElementById` (function) - No description.
- `isHiddenInManual` (function) - True when the element or one of its ancestors inside the manual is not rendered \( display: none \).
- `captureScrollPositions` (function) - Record the scroll positions of the page and of every ancestor of from , so a fragment navigation \(which the browser may scroll for\) can be undone.
- `replaceUrlFragment` (function) - Replace the URL fragment without adding a history entry.

## src/components/Manual/manualSearch.js

In\-manual text search: locale\-aware case folding, match collection over the rendered manual and highlighting through the CSS Custom Highlight API with a \`&lt;mark&gt;\` fallback.

Exports: `MANUAL_SEARCH_MIN_LENGTH`, `MANUAL_SEARCH_DEBOUNCE_MS`, `collectManualTextMatches`, `canUseCustomHighlight`, `applyCustomHighlight`, `applyMarkFallback`, `setCurrentMark`, `removeMarkFallback`, `revealManualMatch`

Symbols:

- `MANUAL_SEARCH_MIN_LENGTH` (constant) - Minimum query length before the manual search runs.
- `MANUAL_SEARCH_DEBOUNCE_MS` (constant) - Debounce delay before a typed query is applied to the rendered manual text.
- `MANUAL_SEARCH_HIGHLIGHT_NAME` (constant) - Name of the shared CSS Custom Highlight covering every manual search hit.
- `MANUAL_SEARCH_CURRENT_HIGHLIGHT_NAME` (constant) - Name of the CSS Custom Highlight covering only the current manual search hit.
- `MANUAL_SEARCH_MARK_ATTRIBUTE` (constant) - Attribute marking fallback &lt;mark&gt; wrappers with their hit index.
- `createManualSearchFolder` (function) - Build a case\-folding function that lowers one character through the UI locale, so Swedish characters such as å/ä/ö fold correctly instead of by raw code units.
- `foldManualSearchText` (function) - Case\-fold text one code point at a time and keep, for every folded code unit, the original code\-unit range of the character it came from.
- `collectManualTextMatches` (function) - Find every non\-overlapping occurrence of the query in the rendered manual text.
- `canUseCustomHighlight` (function) - No description.
- `applyCustomHighlight` (function) - Highlight every match through the CSS Custom Highlight API without touching the manual DOM at all.
- `applyMarkFallback` (function) - Fallback highlighter for browsers without the CSS Custom Highlight API: wrap every match in a &lt;mark&gt; carrying its hit index.
- `setCurrentMark` (function) - No description.

## src/components/Manual/ManualView.jsx

Shared manual body: loads the configured manual source for the current UI language, filters the standard manual by enabled features, renders a contents tree built from the h2/h3 headings, an in\-manual search with highlig

Exports: `MANUAL_CONTENTS_ID`, `MANUAL_SEARCH_INPUT_ID`, `ManualView`

Local imports: `src/utils/runtimeConfig.js`, `src/utils/manualContentsTree.js`, `src/components/Manual/manualDocument.js`, `src/components/Manual/manualSearch.js`, `src/components/Manual/manualNavigation.js`

Symbols:

- `MANUAL_CONTENTS_ID` (constant) - Id of the contents tree; the narrow\-window toggle points at it with aria\-controls.
- `MANUAL_SEARCH_INPUT_ID` (constant) - Id of the manual search field.
- `ManualDocumentState` (typedef) - State of the loaded manual document as reported to the host.
- `normalizeSectionId` (function) - No description.
- `module.exports` (function) - No description.
- `ManualView~pinSectionFor` (constant) - Make the section holding target current and keep it current until the reader scrolls.
- `ManualView~setManualFragment` (constant) - Set the URL fragment for a manual link whose target is styled through :target \(the bundled manuals' image lightbox\), without moving the content pane, the host or the page behind i...
- `ManualView~restoreViewerFragment` (constant) - Put back the URL fragment the page had before the manual set one.
- `ManualView~navigateToManualTarget` (constant) - Scroll the content pane \(never the tree\) to an element in the manual and focus it.
- `<anonymous>~handleEscape` (function) - No description.
- `ManualView~renderContentsLink` (function) - No description.
