/**
 * @vitest-environment node
 */

import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseSync, traverse } from '@babel/core';
import { beforeAll, describe, expect, it } from 'vitest';
import en from '../public/locales/en/common.json';
import sv from '../public/locales/sv/common.json';

const SOURCE = fileURLToPath(new URL('../src/', import.meta.url));

function leafKeys(table, prefix = '') {
  return Object.entries(table).flatMap(([name, value]) => {
    const key = `${prefix}${name}`;
    return typeof value === 'string' ? [key] : leafKeys(value, `${key}.`);
  });
}

function literalKeys(argument, followBinding = true) {
  if (argument.isStringLiteral()) return [argument.node.value];
  if (argument.isTemplateLiteral() && argument.node.expressions.length === 0) {
    return [argument.node.quasis[0].value.cooked];
  }
  if (argument.isConditionalExpression()) {
    return [
      ...literalKeys(argument.get('consequent'), followBinding),
      ...literalKeys(argument.get('alternate'), followBinding),
    ];
  }
  if (argument.isArrayExpression()) {
    return argument.get('elements').flatMap((element) => literalKeys(element, followBinding));
  }
  if (followBinding && argument.isIdentifier()) {
    const binding = argument.scope.getBinding(argument.node.name);
    if (binding?.kind === 'const' && binding.path.isVariableDeclarator()) {
      // Resolve one local binding so recursive aliases cannot loop.
      return literalKeys(binding.path.get('init'), false);
    }
  }
  return [];
}

function usedLocaleKeys() {
  const keys = new Map();
  for (const entry of readdirSync(SOURCE, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile() || !/\.(js|jsx|mjs)$/.test(entry.name) || /\.(test|spec)\./.test(entry.name)) continue;
    const file = path.join(entry.parentPath, entry.name);
    const relative = path.relative(SOURCE, file);
    if (relative.split(path.sep).some((part) => ['__tests__', 'generated'].includes(part))) continue;
    const sourcePath = `src/${relative.replaceAll(path.sep, '/')}`;
    const addKeys = (argument) => {
      for (const value of literalKeys(argument)) {
        if (value.includes(':') && !value.startsWith('common:')) continue;
        const key = value.replace(/^common:/, '');
        if (!keys.has(key)) keys.set(key, `${sourcePath}:${argument.node.loc.start.line}`);
      }
    };

    const ast = parseSync(readFileSync(file, 'utf8'), {
      filename: file,
      babelrc: false,
      configFile: false,
      parserOpts: { plugins: ['jsx'] },
    });
    traverse(ast, {
      'CallExpression|OptionalCallExpression'(call) {
        const callee = call.get('callee');
        // `tr` and `translate` are the viewer's wrappers for `t` with English fallbacks.
        const direct = callee.isIdentifier() && ['t', 'tr', 'translate'].includes(callee.node.name);
        const member = callee.isMemberExpression() || callee.isOptionalMemberExpression();
        const method = member && (callee.node.computed
          ? callee.get('property').isStringLiteral({ value: 't' })
          : callee.get('property').isIdentifier({ name: 't' }));
        const [argument] = call.get('arguments');
        if ((direct || method) && argument) addKeys(argument);
      },
      ObjectProperty(property) {
        // Zoom field descriptors pass their literal labelKey to t when rendered.
        if (sourcePath.endsWith('/ZoomButtons.jsx') && !property.node.computed &&
            property.get('key').isIdentifier({ name: 'labelKey' })) {
          addKeys(property.get('value'));
        }
      },
    });
  }
  return keys;
}

describe('common locale keys', () => {
  const enKeys = new Set(leafKeys(en));
  const svKeys = new Set(leafKeys(sv));
  let usedKeys;
  beforeAll(() => { usedKeys = usedLocaleKeys(); });

  it('has the same leaf keys in English and Swedish', () => {
    expect([...enKeys].filter((key) => !svKeys.has(key)).sort(), 'English only').toEqual([]);
    expect([...svKeys].filter((key) => !enKeys.has(key)).sort(), 'Swedish only').toEqual([]);
  });

  it('finds literal calls from the performance overlay and other viewer components', () => {
    expect(usedKeys.has('perf.copySnapshot')).toBe(true);
    expect(usedKeys.has('perf.downloadHostMetadata')).toBe(true);
    expect(usedKeys.has('toolbar.compare.disable')).toBe(true);
    expect(usedKeys.has('errorBoundary.title')).toBe(true);
    expect(usedKeys.has('toolbar.fitCustomWidthFactor.widthLabel')).toBe(true);
  });

  it.each([['en', enKeys], ['sv', svKeys]])('has every literal key used by the viewer in %s', (_lang, keys) => {
    const missing = [...usedKeys]
      .filter(([key]) => !keys.has(key))
      .map(([key, location]) => `${key} (${location})`)
      .sort();
    expect(missing, missing.join('\n')).toEqual([]);
  });
});
