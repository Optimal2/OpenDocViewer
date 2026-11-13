/** Identify modern raster formats by bytes, independently of names and MIME hints. */
export function hasJxlSignature(bytes) {
  if (bytes?.length >= 2 && bytes[0] === 0xff && bytes[1] === 0x0a) return true;
  const signature = [0, 0, 0, 12, 74, 88, 76, 32, 13, 10, 135, 10];
  return bytes?.length >= signature.length && signature.every((value, index) => bytes[index] === value);
}

/** Accept AVIF major or compatible brands only within the first ISO BMFF ftyp box. */
export function hasAvifSignature(bytes) {
  if (!bytes || bytes.length < 16) return false;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const size = view.getUint32(0);
  if (size < 16 || size % 4 !== 0 || String.fromCharCode(...bytes.subarray(4, 8)) !== 'ftyp') return false;
  const isAvif = (offset) => ['avif', 'avis'].includes(String.fromCharCode(...bytes.subarray(offset, offset + 4)));
  if (isAvif(8)) return true;
  for (let offset = 16; offset + 4 <= Math.min(size, bytes.length); offset += 4) {
    if (isAvif(offset)) return true;
  }
  return false;
}
