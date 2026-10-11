// Synthetic, font-independent annotation appearances for real pdf.js rendering tests.
// All coordinates are PDF user units; no customer documents or binary fixtures.
import { PdfBuilder } from './generate-signature-fixtures.mjs';

export const ANNOTATION_CASES = [
  { name: 'text', subtype: 'Widget', fieldType: 'Tx', rect: [60, 640, 320, 700], flags: 0, paints: true },
  { name: 'checkbox', subtype: 'Widget', fieldType: 'Btn', rect: [60, 520, 320, 580], flags: 0, paints: true },
  { name: 'hidden', subtype: 'Widget', fieldType: 'Tx', rect: [60, 400, 320, 460], flags: 2, paints: false },
  { name: 'no-view', subtype: 'Widget', fieldType: 'Tx', rect: [60, 280, 320, 340], flags: 32, paints: false },
  { name: 'square', subtype: 'Square', rect: [60, 160, 320, 220], flags: 0, paints: true },
];

export function createAnnotationFixture() {
  const builder = new PdfBuilder();
  const refs = ANNOTATION_CASES.map((_, index) => `${10 + index} 0 R`);
  builder.set(1, '<< /Type /Catalog /Pages 2 0 R /AcroForm 5 0 R >>');
  builder.set(2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
  builder.set(3, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << >> /Contents 6 0 R /Annots [${refs.join(' ')}] >>`);
  builder.set(5, `<< /Fields [${refs.slice(0, 4).join(' ')}] /NeedAppearances false >>`);
  // A black page-content anchor prevents an empty/failed raster from passing
  // the negative appearance checks.
  const content = '0 g 400 740 80 40 re f';
  builder.set(6, `<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
  const appearance = '0.12 0.31 0.85 rg 0 0 260 60 re f';
  builder.set(7, `<< /Type /XObject /Subtype /Form /BBox [0 0 260 60] /Resources << >> /Length ${appearance.length} >>\nstream\n${appearance}\nendstream`);
  ANNOTATION_CASES.forEach((item, index) => {
    const field = item.fieldType ? `/FT /${item.fieldType} /T (${item.name})` : '';
    // Checkbox appearances are selected by /AS from a state dictionary, unlike
    // text widgets and ordinary annotations, which use a direct /N stream.
    const ap = item.fieldType === 'Btn'
      ? '/V /Yes /AS /Yes /AP << /N << /Yes 7 0 R >> >>'
      : '/AP << /N 7 0 R >>';
    builder.set(10 + index, `<< /Type /Annot /Subtype /${item.subtype} /NM (${item.name}) ${field} /P 3 0 R /Rect [${item.rect.join(' ')}] /F ${item.flags} ${ap} >>`);
  });
  return builder.serialize().bytes;
}
