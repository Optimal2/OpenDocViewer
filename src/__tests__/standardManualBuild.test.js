import { afterEach, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const GENERATOR_PATH = fileURLToPath(new URL('../../scripts/build-standard-manual.mjs', import.meta.url));
const PACKAGE_PATH = fileURLToPath(new URL('../../package.json', import.meta.url));
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

function makeFixture({
  sv = '<main><h2 id="intro">Introduktion</h2></main>',
  en = '<main><h2 id="intro">Introduction</h2></main>',
  ruleIds = ['intro'],
  manifest = `export const standardManualRuleIds = ${JSON.stringify(ruleIds)};\n`,
} = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'odv-standard-manual-'));
  tempRoots.push(root);
  writeFixture(root, 'public/help/default/manual.sv.html', sv);
  writeFixture(root, 'public/help/default/manual.en.html', en);
  if (manifest !== null) writeFixture(root, 'src/utils/standardManualRules.js', manifest);
  return root;
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

  it('fails when a manifest id is absent from both languages and writes no partial output', async () => {
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

  it('fails clearly when the manifest or its standardManualRuleIds export is absent', async () => {
    const withoutManifest = makeFixture({ manifest: null });
    await expect(generate(withoutManifest)).rejects.toThrow(
      /standard manual manifest not found[\s\S]*standardManualRuleIds/i,
    );

    const withoutExport = makeFixture({ manifest: 'export const somethingElse = [];\n' });
    await expect(generate(withoutExport)).rejects.toThrow(/standardManualRuleIds.*flat array/i);
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
});

describe('standard manual package wiring', () => {
  it('generates before development, tests, UI tests and production builds', () => {
    const scripts = JSON.parse(fs.readFileSync(PACKAGE_PATH, 'utf8')).scripts;

    expect(scripts['build:standard-manual']).toBe('node scripts/build-standard-manual.mjs');
    for (const name of ['dev', 'test', 'test:watch', 'test:ui', 'build']) {
      expect(scripts[name], name).toMatch(/^npm run build:standard-manual && /);
    }
  });
});
