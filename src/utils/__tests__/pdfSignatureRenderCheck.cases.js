// Shared cases for the pdf.js differential tests. Each `bytes(f, fixture, multi)`
// takes the security fixtures (scripts/signature-security-fixtures.mjs), a
// reader for scripts/fixtures/ and the multi-page fixtures.

const CHANGED = /CHANGED (CONTENT )?AFTER SIGNING/;

/** Known attacks whose changed text pdf.js draws in the final file. */
export const attackFiles = [
  { label: 'escaped /Root key in an appended trailer (round 7, F1)', marker: CHANGED,
    bytes: (f, fixture) => fixture('attack-escaped-root-key.pdf') },
  { label: 'forged xref table and startxref inside appended stream data (round 7, F2)', marker: CHANGED,
    bytes: (f, fixture) => fixture('attack-startxref-in-stream-data.pdf') },
  { label: 'shadow object', marker: CHANGED, bytes: (f) => f.revisions.shadowObject },
  { label: 'shadow object on a signed xref stream', marker: CHANGED, bytes: (f) => f.signedXrefStream.shadowObject },
  { label: 'shadow object on a linearized file', marker: CHANGED, bytes: (f) => f.linearized.shadowObject },
  { label: 'unlinked decoy xref table', marker: CHANGED, bytes: (f) => f.revisions.unlinkedDecoyXrefTable },
  { label: 'unlinked decoy xref stream', marker: CHANGED, bytes: (f) => f.revisions.unlinkedDecoyXrefStream },
  { label: 'dangling reference filled by a new object', marker: CHANGED, bytes: (f) => f.revisions.danglingReferenceFilled },
  { label: 'dangling reference filled by an object stream', marker: CHANGED,
    bytes: (f) => f.revisions.danglingReferenceFilledByObjectStream },
  { label: 'dangling reference filled by an xref stream with drawing operators', marker: CHANGED,
    bytes: (f) => f.revisions.danglingReferenceFilledByDrawingXrefStream },
  { label: 'linearized /L set to the final length', marker: CHANGED, bytes: (f) => f.linearized.lengthExploit.exploit },
  { label: 'linearized /L with a #4c-escaped duplicate key', marker: CHANGED,
    bytes: (f) => f.linearized.lengthExploitEscapedName.exploit },
  { label: '/Linearized in a first-object xref stream', marker: CHANGED,
    bytes: (f) => f.linearized.lengthExploitXrefStream.exploit },
  { label: 'linearization dictionary before the %PDF- header', marker: CHANGED,
    bytes: (f) => f.linearized.lengthExploitBeforeHeader.exploit },
  { label: 'replaced page content stream', marker: CHANGED, bytes: (f) => f.revisions.pageContent },
  { label: 'linearized content change (qpdf, object streams)', marker: CHANGED, bytes: (f) => f.linearized.contentChanged.qpdfObjStm },
  { label: 'content change on a late page of a multi-page document', marker: CHANGED, bytes: (f, fixture, multi) => multi.contentChanged }
];

/** Content changes pdf.js shows without a text marker (annotations, actions, geometry, fields). */
export const contentChangeFiles = [
  ['adds an annotation', (f) => f.revisions.annotation],
  ['changes /MediaBox', (f) => f.revisions.pageKey],
  ['changes a form field value', (f) => f.revisions.fieldValue],
  ['adds catalog /OpenAction', (f) => f.revisions.openAction],
  ['adds a visible timestamp widget', (f) => f.revisions.visibleTimestampWidget],
  ['a later revision adds an annotation after DSS', (f) => f.revisions.laterRevisionAddsAnnotation],
  ['deletes a live object', (f) => f.revisions.freeLiveObject],
  ['replaces the image data behind unchanged drawing operators', (f, fixture, multi) => multi.imageChanged]
];

/**
 * Structural changes pdf.js draws identically (nothing visible changes); only
 * the pdf-lib rules warn about them, as defense in depth.
 */
export const invisibleChangeFiles = [
  ['an xref stream fills a dangling content reference without drawable data', (f) => f.revisions.danglingReferenceFilledByXrefStream],
  ['a zero-area timestamp widget with a (dangling) appearance reference', (f) => f.revisions.timestampWidgetWithAppearance]
];

/** Honest validation-data appends: green before and after the comparison. */
export const honestFiles = [
  ...['okDss', 'okInfo', 'okMetadata', 'okXrefOnly', 'okDssXrefStream', 'okDssXrefStreamCompressed', 'okDssObjectStream',
    'okInfoXrefStream', 'okMetadataXrefStream', 'okXrefOnlyXrefStream', 'okRevertedChange', 'okDocTimestampThenDss',
    'okUnverifiedDocTimestamp'].map((name) => ({ label: name, bytes: (f) => f.revisions[name] })),
  ...['dssOnly', 'dssObjectStream', 'dssCompressed', 'dssOnlySignedStructuralReference', 'dssOnlyRelistsSignedStructural']
    .map((name) => ({ label: `signed xref stream: ${name}`, bytes: (f) => f.signedXrefStream[name] })),
  ...['incremental', 'inside', 'qpdfTable', 'qpdfObjStm']
    .map((name) => ({ label: `linearized: ${name}`, bytes: (f) => f.linearized.dss[name] })),
  { label: 'multi-page document', bytes: (f, fixture, multi) => multi.dss },
  { label: 'escaped name next to a Line-annotation /L key', bytes: (f, fixture) => fixture('dss-escaped-name-with-line-key.pdf') },
  { label: 'escaped name next to /L as a nested value', bytes: (f, fixture) => fixture('dss-escaped-name-with-nested-l-value.pdf') }
];
