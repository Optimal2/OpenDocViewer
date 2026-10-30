"""Regenerate the qpdf-linearized base files for the appended-revision tests.

The signature fixtures are synthetic and generated at test time in Node, but
Node has no linearizer. These two small UNSIGNED one-page files are written
once by a real linearizer (qpdf, through pikepdf) and committed; the tests sign
and extend them (scripts/signature-revision-fixtures.mjs). No real document,
name or certificate is involved.

Usage: python scripts/generate-linearized-fixture-bases.py
Requires: pikepdf (bundles libqpdf). Output: scripts/fixtures/linearized-qpdf-*.pdf
"""

from pathlib import Path

import pikepdf

TEXT = b"BT /F1 20 Tf 60 780 Td (ODV SIGNATURE FIXTURE SAMPLE TEXT 0123456789) Tj ET"
OUT = Path(__file__).resolve().parent / "fixtures"


def base_document():
    pdf = pikepdf.new()
    font = pdf.make_indirect(pikepdf.Dictionary(
        Type=pikepdf.Name.Font, Subtype=pikepdf.Name.Type1, BaseFont=pikepdf.Name.Helvetica))
    page = pikepdf.Dictionary(
        Type=pikepdf.Name.Page,
        MediaBox=[0, 0, 595, 842],
        Resources=pikepdf.Dictionary(Font=pikepdf.Dictionary(F1=font)),
        Contents=pdf.make_stream(TEXT))
    pdf.pages.append(pikepdf.Page(page))
    return pdf


def main():
    OUT.mkdir(exist_ok=True)
    variants = {
        # Classic xref tables: first-page table + main table.
        "linearized-qpdf-table.pdf": pikepdf.ObjectStreamMode.disable,
        # Cross-reference streams and object streams in both linearization parts.
        "linearized-qpdf-objstm.pdf": pikepdf.ObjectStreamMode.generate,
    }
    for name, mode in variants.items():
        with base_document() as pdf:
            pdf.save(OUT / name, linearize=True, object_stream_mode=mode,
                     compress_streams=False, deterministic_id=True)
        print(f"wrote {OUT / name} (qpdf {pikepdf.__libqpdf_version__})")


if __name__ == "__main__":
    main()
