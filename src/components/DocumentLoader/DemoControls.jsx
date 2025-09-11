// File: src/components/DocumentLoader/DemoControls.js
/**
 * File: src/components/DocumentLoader/DemoControls.js
 *
 * OpenDocViewer — Demo Controls for “one-file-per-format” demo mode
 *
 * PURPOSE
 *   - Provide a simple control bar: "Total pages/files" + JPG/PNG/TIF/PDF buttons + a new "Mix" button.
 *   - Mount <DocumentLoader/> with the new demo-mode props to generate URLs from public/sample.*.
 *   - Force a reload of the loader when settings change by varying the component `key`.
 *
 * DESIGN NOTES
 *   - This component does not alter loader internals. It simply toggles props and remounts the loader.
 *   - The viewer subtree should be supplied as children and will render inside the loader.
 *
 * USAGE
 *   <DemoControls>{children}</DemoControls>
 *
 * REQUIREMENTS
 *   - Ensure the following exist in /public: sample.jpg, sample.png, sample.tif, sample.pdf.
 *   - DocumentLoader must include the demo-mode props introduced in this refactor.
 */

import React, { useMemo, useState } from 'react';
import DocumentLoader from './DocumentLoader';

/**
 * DemoControls — wraps DocumentLoader with demo-mode props and a small control UI.
 *
 * @param {Object} props
 * @param {*} props.children  The viewer subtree to render inside DocumentLoader
 * @returns {React.ReactElement}
 */
export default function DemoControls({ children }) {
  const [count, setCount] = useState(10);
  const [format, setFormat] = useState('png');   // 'jpg'|'png'|'tif'|'pdf'
  const [mix, setMix] = useState(false);

  // Force a clean remount of the loader when any control changes
  const loaderKey = useMemo(
    () => `demo:${mix ? 'mix' : 'repeat'}:${format}:${count}`,
    [mix, format, count]
  );

  // Button helpers
  const selectFormat = (fmt) => { setMix(false); setFormat(fmt); };

  return (
    <div style={{ padding: 12 }}>
      {/* Controls row */}
      <div className="odv-allow-select" style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <label style={{ marginRight: 6 }}>Total pages/files:</label>
        <input
          type="number"
          min={1}
          value={count}
          onChange={(e) => setCount(Math.max(1, Number(e.target.value) || 1))}
          style={{ width: 80, marginRight: 12 }}
        />

        <button onClick={() => selectFormat('jpg')}>JPG</button>
        <button onClick={() => selectFormat('png')}>PNG</button>
        <button onClick={() => selectFormat('tif')}>TIF</button>
        <button onClick={() => selectFormat('pdf')}>PDF</button>

        <button onClick={() => setMix((v) => !v)} style={{ marginLeft: 12 }}>
          {mix ? 'Mix: ON' : 'Mix'}
        </button>
      </div>

      {/* DEMO MODE mount — uses /public/sample.(jpg|png|tif|pdf) */}
      <DocumentLoader
        key={loaderKey}
        demoMode={true}
        demoStrategy={mix ? 'mix' : 'repeat'}
        demoCount={count}
        demoFormats={mix ? ['jpg', 'png', 'tif', 'pdf'] : [format]}
        sameBlob={true}
      >
        {children}
      </DocumentLoader>
    </div>
  );
}
