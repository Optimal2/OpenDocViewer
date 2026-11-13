import { hasJxlSignature } from './modernImageSignatures.js';
import { sha256 } from '@noble/hashes/sha2.js';

function sha256Hex(bytes) {
  return Array.from(sha256(bytes), (value) => value.toString(16).padStart(2, '0')).join('');
}

/** Decode-time input bound: 100 megapixels, checked before any rendered frame is allocated. */
export const MAX_JXL_PIXELS = 100_000_000;

function assertJxlDimensionsWithinLimit(width, height) {
  const area = Number(width) * Number(height);
  if (Number.isFinite(area) && area <= MAX_JXL_PIXELS) return;
  const error = new Error(`JPEG XL image dimensions ${width} x ${height} exceed the decode limit of 100 megapixels.`);
  error.name = 'JxlDimensionLimitError';
  error.code = 'JXL_DIMENSION_LIMIT_EXCEEDED';
  throw error;
}

let codecPromise;
function loadCodec() {
  if (!codecPromise) {
    codecPromise = Promise.all([
      import('jxl-oxide-wasm'),
      import('jxl-oxide-wasm/module.wasm?url'),
    ]).then(async ([codec, { default: wasmUrl }]) => {
      await codec.default({ module_or_path: wasmUrl });
      return codec;
    }).catch((error) => { codecPromise = null; throw error; });
  }
  return codecPromise;
}

/**
 * Decode frame 1 in our Rust/WASM codec. Its PNG encoder retains alpha and 16-bit samples;
 * a canvas roundtrip would quantize those samples to 8 bits. Never hand JXL to a native decoder.
 * @param {Blob} source
 * @returns {Promise<Object>} PNG asset with explicit first-frame metadata.
 */
export async function decodeJxl(source) {
  const bytes = new Uint8Array(await source.arrayBuffer());
  if (!hasJxlSignature(bytes)) throw new Error('Invalid JPEG XL signature');
  const { JxlImage } = await loadCodec();
  const image = new JxlImage();
  try {
    image.forceSrgb = false;
    image.feedBytes(bytes);
    if (!image.tryInit() || !image.loaded || image.numLoadedKeyframes < 1) {
      throw new Error('Incomplete JPEG XL image');
    }
    assertJxlDimensionsWithinLimit(image.width, image.height);
    const frame = image.render(0);
    // encodeToPng consumes and frees the render result, including on encoding failure.
    const png = frame.encodeToPng();
    return {
      blob: new Blob([png], { type: 'image/png' }),
      width: image.width,
      height: image.height,
      mimeType: 'image/png',
      imageMetadata: {
        sourceFormat: 'image/jxl',
        displayedFrame: 1,
        frameCount: image.numLoadedKeyframes,
        animated: !!image.animated,
        sourceSha256: sha256Hex(bytes),
        outputFormat: 'image/png',
        outputSha256: sha256Hex(png),
      },
    };
  } finally { image.free(); }
}
