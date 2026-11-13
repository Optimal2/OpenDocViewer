# JPEG XL and AVIF input

OpenDocViewer accepts `image/jxl` (`.jxl`) and `image/avif` (`.avif`) from URLs,
inline sources and source packs. Detection checks the bytes: JPEG XL's `FF 0A`
codestream signature or its complete 12-byte container signature, and AVIF's
`ftyp` major/compatible `avif` or `avis` brand. A name or MIME hint alone does
not authorize these formats.

JPEG XL is decoded by `jxl-oxide-wasm` 0.12.6 in the page-asset worker. The
same lazy decoder is used by the main-thread fallback; neither path gives JPEG XL
to an HTML image or `createImageBitmap`. Its WASM PNG encoder preserves alpha
and 16-bit samples without a canvas roundtrip. Only thumbnails use a canvas to
scale that PNG. The decoder and WASM are requested only after JPEG XL is encountered.
Deploy the complete Vite output, including the hashed WASM asset. The existing
IIS configuration serves `.wasm` as `application/wasm`; CSP must permit
`script-src 'wasm-unsafe-eval'`, as in the bundled configuration.

Animated JPEG XL is represented by one page showing the first displayed frame.
Page assets carry `imageMetadata` with `sourceFormat`, `displayedFrame` (1-based),
`frameCount` and `animated`. These fields survive worker transport and asset
storage/restoration. Remaining animation frames are not viewer pages.
The same metadata records `sourceSha256`, `outputFormat` and `outputSha256`
for the original JPEG XL and its full-resolution PNG conversion. Thumbnail metadata
refers to this full-resolution conversion, before scaling.

AVIF uses the browser decoder and is converted to PNG for page assets. PNG
assets feed thumbnails and generated PDFs. Both PDF backends embed PNG losslessly
and report an error if PNG insertion fails instead of converting it to JPEG.
This viewer does not implement archival delivery or JPEG bitstream reconstruction;
the original input bytes remain subject to the normal source-store lifecycle.

Synthetic fixtures and their exact generation command are documented in
`tests/fixtures/modern-images/README.md`. Unit tests verify 8/16-bit pixel equality,
alpha, animation metadata and invalid signatures. Playwright exercises the real
viewer, both rendering backends, thumbnails and generated PDF image filters.
