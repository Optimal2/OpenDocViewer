"""Synthetic fixtures only. Requires numpy 2.0.2, imagecodecs 2026.11.11.

Run: python scripts/generate-modern-image-fixtures.py
No encoder or Python dependency is used by the application or its CI tests.
"""
from pathlib import Path
import hashlib
import imagecodecs
import numpy as np

DEST = Path(__file__).resolve().parents[1] / 'tests' / 'fixtures' / 'modern-images'
DEST.mkdir(parents=True, exist_ok=True)
y, x = np.indices((24, 32))
rgba = np.stack((x * 7, y * 10, (x + y) * 4, 64 + (x % 4) * 63), axis=-1).astype('uint8')
rgba16 = rgba.astype('uint16') * 257 + 19
rgba16[:, :, 3] = 32768

for name, pixels, container in [('gradient', rgba, False), ('gradient16', rgba16, True)]:
    encoded = imagecodecs.jpegxl_encode(pixels, lossless=True, effort=3,
                                      usecontainer=container, transfer='SRGB')
    (DEST / f'{name}.jxl').write_bytes(encoded)
    (DEST / f'{name}.png').write_bytes(imagecodecs.png_encode(pixels))
    assert np.array_equal(imagecodecs.jpegxl_decode(encoded), pixels)

jpeg = imagecodecs.jpeg_encode(np.ascontiguousarray(rgba[:, :, :3]), level=90)
reconstructed = imagecodecs.jpegxl_encode_jpeg(jpeg, usecontainer=True)
(DEST / 'reconstruction.jpg').write_bytes(jpeg)
(DEST / 'reconstruction.jxl').write_bytes(reconstructed)
assert hashlib.sha256(imagecodecs.jpegxl_decode_jpeg(reconstructed)).digest() == hashlib.sha256(jpeg).digest()
(DEST / 'gradient.avif').write_bytes(imagecodecs.avif_encode(rgba, level=100))
frames = np.stack((rgba, np.ascontiguousarray(rgba[:, ::-1, :])))
(DEST / 'animated.jxl').write_bytes(imagecodecs.jpegxl_encode(frames, lossless=True, effort=3, usecontainer=True))
for path in sorted(DEST.iterdir()):
    if path.suffix != '.md':
        print(path.name, hashlib.sha256(path.read_bytes()).hexdigest())
