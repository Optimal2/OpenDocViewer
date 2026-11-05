import { afterEach, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const GENERATOR_PATH = fileURLToPath(new URL('../../scripts/build-standard-manual.mjs', import.meta.url));
const PACKAGE_PATH = fileURLToPath(new URL('../../package.json', import.meta.url));
const REPOSITORY_ROOT = fileURLToPath(new URL('../../', import.meta.url));
const tempRoots = [];
let importSequence = 0;

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

function writeFixture(root, relativePath, content) {
  const destination = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.writeFileSync(destination, content, 'utf8');
}

function mainDocument(language, id, guide) {
  return { file: `manual.${language}.html`, ...(guide ? { guide } : {}), id };
}

function standaloneDocument(guideName, language, id) {
  return { file: `manual-${guideName}.${language}.html`, id };
}

function manifestSource(logicalRules) {
  const ruleIds = logicalRules.flatMap((rule) => (
    Object.values(rule.documents).flatMap((documents) => documents.map((document) => document.id))
  ));
  return `export const standardManualLogicalRules = ${JSON.stringify(logicalRules)};\n`
    + `export const standardManualRuleIds = ${JSON.stringify([...new Set(ruleIds)])};\n`;
}

function localizedLogicalRules() {
  return [{
    id: 'compare.overlay',
    state: 'overlay',
    documents: {
      sv: [
        standaloneDocument('jamforelse', 'sv', 'overlagring'),
        mainDocument('sv', 'jmf-overlagring', 'guide-jamforelse'),
      ],
      en: [
        standaloneDocument('jamforelse', 'en', 'overlay'),
        mainDocument('en', 'jmf-overlay', 'guide-jamforelse'),
      ],
    },
  }];
}

function makeFixture({
  sv = '<main><h2 id="intro">Introduktion</h2></main>',
  en = '<main><h2 id="intro">Introduction</h2></main>',
  ruleIds = ['intro'],
  logicalRules,
  manifest,
  extraFiles = {},
} = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'odv-standard-manual-'));
  tempRoots.push(root);
  writeFixture(root, 'public/help/default/manual.sv.html', sv);
  writeFixture(root, 'public/help/default/manual.en.html', en);
  for (const [relativePath, content] of Object.entries(extraFiles)) {
    writeFixture(root, path.join('public/help/default', relativePath), content);
  }
  const rules = logicalRules || [{
    id: 'fixture.rule',
    state: 'fixture',
    documents: {
      sv: ruleIds.map((id) => mainDocument('sv', id)),
      en: ruleIds.map((id) => mainDocument('en', id)),
    },
  }];
  if (manifest !== null) {
    writeFixture(root, 'src/utils/standardManualRules.js', manifest ?? manifestSource(rules));
  }
  return root;
}

function makeLocalizedFixture({ logicalRules = localizedLogicalRules() } = {}) {
  return makeFixture({
    sv: '<main><details id="guide-jamforelse"><details><summary>Nested</summary></details>'
      + '<h2 id="jmf-overlagring">Överlagring</h2></details></main>',
    en: '<main><details id="guide-jamforelse"><details><summary>Nested</summary></details>'
      + '<h2 id="jmf-overlay">Overlay</h2></details></main>',
    logicalRules,
    extraFiles: {
      'manual-jamforelse.sv.html': '<main><h2 id="overlagring">Överlagring</h2></main>',
      'manual-jamforelse.en.html': '<main><h2 id="overlay">Overlay</h2></main>',
    },
  });
}

async function generate(root) {
  const { buildStandardManual } = await import(pathToFileURL(GENERATOR_PATH).href);
  return buildStandardManual({ rootDir: root });
}

async function readGenerated(root, language) {
  const outputPath = path.join(root, 'src/generated/standard-manual', `manual.${language}.js`);
  const moduleUrl = `${pathToFileURL(outputPath).href}?read=${++importSequence}`;
  return (await import(moduleUrl)).default;
}

describe('standard manual generation', () => {
  it('writes loadable modules that preserve the exact HTML and JavaScript-sensitive characters', async () => {
    const sv = '<main>\r\n<h2 id="intro">Citat " \\ ${value}</h2>\r\n<p>unicode:\u2028\u2029</p></main>';
    const en = '<main><h2 id="intro">A "quote", a \\ slash and ${value}</h2><p>\u2028\u2029</p></main>';
    const root = makeFixture({ sv, en });

    const result = await generate(root);

    expect(await readGenerated(root, 'sv')).toBe(sv);
    expect(await readGenerated(root, 'en')).toBe(en);
    expect(result.outputFiles).toHaveLength(2);
    expect(fs.readFileSync(result.outputFiles[0], 'utf8')).toMatch(/^export default /);
  });

  it('regenerates output when a source manual changes', async () => {
    const root = makeFixture();
    await generate(root);
    const updated = '<main><h2 id="intro">Updated introduction</h2><p>New text</p></main>';
    writeFixture(root, 'public/help/default/manual.en.html', updated);

    await generate(root);

    expect(await readGenerated(root, 'en')).toBe(updated);
  });

  it('fails when a required id is absent from both languages and writes no partial output', async () => {
    const root = makeFixture({ ruleIds: ['intro', 'missing-rule'] });

    await expect(generate(root)).rejects.toThrow(
      /manual\.sv\.html: missing-rule[\s\S]*manual\.en\.html: missing-rule/,
    );
    expect(fs.existsSync(path.join(root, 'src/generated/standard-manual'))).toBe(false);
  });

  it('fails when Swedish and English manifest id coverage disagree', async () => {
    const root = makeFixture({
      en: '<main><h2 id="intro">Introduction</h2><h2 id="english-only">English</h2></main>',
      ruleIds: ['intro', 'english-only'],
    });

    await expect(generate(root)).rejects.toThrow(
      /manifest id coverage mismatch[\s\S]*manual\.sv\.html: english-only/,
    );
  });

  it('fails clearly when the manifest or its logical-rule export is absent', async () => {
    const withoutManifest = makeFixture({ manifest: null });
    await expect(generate(withoutManifest)).rejects.toThrow(
      /standard manual manifest not found[\s\S]*standardManualLogicalRules/i,
    );

    const withoutExport = makeFixture({ manifest: 'export const standardManualRuleIds = ["intro"];\n' });
    await expect(generate(withoutExport)).rejects.toThrow(/standardManualLogicalRules.*array/i);
  });

  it('returns a non-zero CLI exit code when validation fails', () => {
    const root = makeFixture({ ruleIds: ['intro', 'missing-rule'] });

    const result = spawnSync(process.execPath, [GENERATOR_PATH, '--root', root], {
      encoding: 'utf8',
      windowsHide: true,
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/manual\.sv\.html: missing-rule/);
    expect(fs.existsSync(path.join(root, 'src/generated/standard-manual'))).toBe(false);
  });

  it('accepts localized aliases in their own standalone and embedded documents', async () => {
    const root = makeLocalizedFixture();

    await generate(root);

    expect(await readGenerated(root, 'sv')).toContain('id="jmf-overlagring"');
    expect(await readGenerated(root, 'en')).toContain('id="jmf-overlay"');
  });

  it.each([
    ['manual-jamforelse.sv.html', 'overlagring'],
    ['manual-jamforelse.en.html', 'overlay'],
    ['manual.sv.html', 'jmf-overlagring'],
    ['manual.en.html', 'jmf-overlay'],
  ])('fails when %s loses its actual required id %s', async (file, id) => {
    const root = makeLocalizedFixture();
    const source = fs.readFileSync(path.join(root, 'public/help/default', file), 'utf8');
    writeFixture(root, path.join('public/help/default', file), source.replace(`id="${id}"`, 'id="removed"'));

    await expect(generate(root)).rejects.toThrow(new RegExp(`compare\\.overlay[\\s\\S]*${file}[\\s\\S]*${id}`));
  });

  it('rejects an embedded id that is present only outside its required guide', async () => {
    const root = makeLocalizedFixture();
    const file = 'manual.en.html';
    const source = fs.readFileSync(path.join(root, 'public/help/default', file), 'utf8');
    const moved = source.replace('<h2 id="jmf-overlay">Overlay</h2>', '')
      .replace('</main>', '<h2 id="jmf-overlay">Overlay</h2></main>');
    writeFixture(root, path.join('public/help/default', file), moved);

    await expect(generate(root)).rejects.toThrow(/guide-jamforelse[\s\S]*jmf-overlay/);
  });

  it('fails when one language omits a logical rule document', async () => {
    const logicalRules = localizedLogicalRules();
    logicalRules[0].documents.en = logicalRules[0].documents.en.slice(1);
    const root = makeLocalizedFixture({ logicalRules });

    await expect(generate(root)).rejects.toThrow(
      /logical rule coverage mismatch[\s\S]*compare\.overlay[\s\S]*manual-jamforelse/i,
    );
  });

  it('generates exact modules from the unchanged real Swedish and English manuals', async () => {
    await generate(REPOSITORY_ROOT);

    for (const language of ['sv', 'en']) {
      const source = fs.readFileSync(
        path.join(REPOSITORY_ROOT, 'public/help/default', `manual.${language}.html`),
        'utf8',
      );
      expect(await readGenerated(REPOSITORY_ROOT, language)).toBe(source);
    }
  });
});

describe('standard manual package wiring', () => {
  it('generates before development, tests, UI tests, production builds and agent docs', () => {
    const scripts = JSON.parse(fs.readFileSync(PACKAGE_PATH, 'utf8')).scripts;

    expect(scripts['build:standard-manual']).toBe('node scripts/build-standard-manual.mjs');
    for (const name of ['dev', 'test', 'test:watch', 'test:ui', 'build', 'doc:agent']) {
      expect(scripts[name], name).toMatch(/^npm run build:standard-manual && /);
    }
  });
});
