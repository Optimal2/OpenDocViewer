# Synthetic modern image fixtures

Generated with Python 3.12, numpy 2.0.2 and imagecodecs 2026.11.11 (prebuilt
libjxl encoder; no native build toolchain). Exact command:

```text
python scripts/generate-modern-image-fixtures.py
```

The generator contains the exact encoder calls. `gradient.jxl` is a lossless
32x24 RGBA gradient in a naked codestream; `gradient16.jxl` is a lossless
16-bit RGBA container. The matching PNGs are pixel references.
`reconstruction.jxl` contains JPEG reconstruction data made with
`imagecodecs.jpegxl_encode_jpeg(..., usecontainer=True)`, the equivalent of
`cjxl reconstruction.jpg reconstruction.jxl --lossless_jpeg=1`. The generator
proves that the reconstructed JPEG's SHA-256 matches `reconstruction.jpg`.
`gradient.avif` exercises the native AVIF input path. All images are synthetic.
`animated.jxl` has two synthetic frames; the viewer presents only the first.
