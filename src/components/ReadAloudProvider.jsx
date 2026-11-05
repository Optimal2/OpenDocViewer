// File: src/components/ReadAloudProvider.jsx
/**
 * Provides the read-aloud state (hooks/useReadAloud.js) to the page's context menu and the
 * toolbar's language menu (contexts/readAloudContext.js). Mounted by DocumentViewer only while
 * `ocr.enabled` is the literal true and `ocr.speech.enabled` is not the literal false; with
 * either off the viewer renders its children without this provider, so nothing follows the
 * selection and speech synthesis is never touched.
 */
import React from 'react';
import PropTypes from 'prop-types';
import ReadAloudContext from '../contexts/readAloudContext.js';
import useReadAloud from '../hooks/useReadAloud.js';

/**
 * @param {{ children: React.ReactNode }} props
 * @returns {React.ReactElement}
 */
export default function ReadAloudProvider({ children }) {
  const value = useReadAloud();
  return <ReadAloudContext.Provider value={value}>{children}</ReadAloudContext.Provider>;
}

ReadAloudProvider.propTypes = {
  children: PropTypes.node,
};
