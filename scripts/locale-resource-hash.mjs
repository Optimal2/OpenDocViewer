// File: scripts/locale-resource-hash.mjs
/**
 * Content hash of the shipped locale files (public/locales/<lng>/<ns>.json). vite.config.js
 * injects it as `import.meta.env.ODV_I18N_RESOURCE_HASH`; src/utils/i18nVersion.js appends it to
 * the build id in the locale URL token, so any change to a locale file yields a new URL while
 * unchanged builds stay deterministic. Line endings are normalized so Windows (CRLF checkout)
 * and CI (LF) builds of the same commit produce the same hash.
 */
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';

/**
 * @param {URL} repoRoot Repository root as a file URL (ending in '/').
 * @param {Map<string, Buffer>} [files] Optional relative path -> content map (tests).
 * @returns {string} First 12 hex characters of the SHA-256 over sorted paths and contents.
 */
export function computeLocaleResourceHash(repoRoot, files = null) {
  const entries = files || readLocaleFiles(new URL('public/locales/', repoRoot));
  const hash = createHash('sha256');
  for (const name of [...entries.keys()].sort()) {
    hash.update(name);
    hash.update('\0');
    hash.update(Buffer.from(entries.get(name)).toString('utf8').replace(/\r\n/g, '\n'));
    hash.update('\0');
  }
  return hash.digest('hex').slice(0, 12);
}

/**
 * @param {URL} localesDir
 * @returns {Map<string, Buffer>}
 */
function readLocaleFiles(localesDir) {
  const files = new Map();
  for (const language of readdirSync(localesDir, { withFileTypes: true })) {
    if (!language.isDirectory()) continue;
    const languageDir = new URL(`${language.name}/`, localesDir);
    for (const file of readdirSync(languageDir, { withFileTypes: true })) {
      if (file.isFile() && file.name.endsWith('.json')) {
        files.set(`${language.name}/${file.name}`, readFileSync(new URL(file.name, languageDir)));
      }
    }
  }
  return files;
}
