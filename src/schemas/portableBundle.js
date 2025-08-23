// File: src/schemas/portableBundle.js

/**
 * @typedef {Object} PortableDocumentBundle
 * @property {{id:string, userId?:string, issuedAt?:string}} session
 * @property {Array<{
 *   documentId: string,
 *   created?: string,
 *   modified?: string,
 *   meta?: any,
 *   files: Array<string|{id?:string, ext?:string, path?:string, url?:string}>
 * }>} documents
 */

export const __portableBundleSchemaVersion = 1;
