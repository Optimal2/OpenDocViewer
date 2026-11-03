// File: src/utils/canvasBitmapSize.js
/**
 * Resize the bitmap of a canvas only when the requested size differs from its current size.
 *
 * Per the HTML specification, setting a canvas's width or height clears the bitmap even when the
 * value is unchanged. The page canvas is drawn by DocumentRender, which learns the size it drew
 * only after drawing; a size re-applied afterwards therefore wiped the freshly drawn page (the
 * 90° → 180° rotation showed an empty page). Going through this helper keeps a bitmap that
 * already has the requested size.
 *
 * @param {(HTMLCanvasElement|null|undefined)} canvas
 * @param {number} width
 * @param {number} height
 * @returns {boolean} true when the bitmap was resized (and therefore cleared).
 */
export function applyCanvasBitmapSize(canvas, width, height) {
  if (!canvas) return false;
  const nextWidth = Math.max(0, Math.floor(Number(width) || 0));
  const nextHeight = Math.max(0, Math.floor(Number(height) || 0));
  let resized = false;
  if (canvas.width !== nextWidth) {
    canvas.width = nextWidth;
    resized = true;
  }
  if (canvas.height !== nextHeight) {
    canvas.height = nextHeight;
    resized = true;
  }
  return resized;
}
