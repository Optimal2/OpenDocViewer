// File: src\integration\events.js
export function emitODVEvent(name, detail = {}) {
  try { window.dispatchEvent(new CustomEvent(name, { detail })); } catch (e) { /* noop */ }
}
