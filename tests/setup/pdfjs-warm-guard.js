// Test-only guard: decide from the AST whether a differential suite genuinely
// opts into the pdf.js warm-up, and read the comparator's default loader
// without a text regex. A text regex misses the full-removal form entirely
// (nothing asserts the opt-in is present) and fails on semantically
// equivalent rewrites of the default loader (reformatting, `||` for `??`,
// a block-bodied arrow). The AST sees neither difference.
import { parseAst } from 'vite';

const WARMUP_MODULE_SUFFIX = 'tests/setup/pdfjs-warm.js';
const WARMUP_IMPORT_NAME = 'warmPdfjs';
const SETUP_HOOK = 'beforeAll';
const OPTIONS_OBJECT = 'options';
const LOAD_PDFJS = 'loadPdfjs';

function parseProgram(source) {
  try {
    const program = parseAst(source);
    return program && program.type === 'Program' ? program : null;
  } catch {
    return null;
  }
}

function childNodes(node) {
  const children = [];
  for (const key of Object.keys(node)) {
    const child = node[key];
    if (Array.isArray(child)) {
      for (const entry of child) {
        if (entry && typeof entry.type === 'string') children.push(entry);
      }
    } else if (child && typeof child.type === 'string') {
      children.push(child);
    }
  }
  return children;
}

// Local names bound to the warmPdfjs import, plus namespace objects, from
// `import { warmPdfjs[, as alias] } from '.../tests/setup/pdfjs-warm.js'`.
// Only the real module counts: a same-named local would not warm anything.
function warmupBindings(program) {
  const names = new Set();
  const namespaces = new Set();
  for (const node of program.body) {
    if (node.type !== 'ImportDeclaration') continue;
    const source = node.source;
    if (!source || source.type !== 'Literal' || typeof source.value !== 'string') continue;
    if (!source.value.endsWith(WARMUP_MODULE_SUFFIX)) continue;
    for (const specifier of node.specifiers) {
      if (specifier.type === 'ImportSpecifier'
        && specifier.imported.type === 'Identifier'
        && specifier.imported.name === WARMUP_IMPORT_NAME) {
        names.add(specifier.local.name);
      } else if (specifier.type === 'ImportNamespaceSpecifier') {
        namespaces.add(specifier.local.name);
      }
    }
  }
  return { names, namespaces };
}

// A reference to the warm-up: the imported identifier (possibly aliased) or
// a `namespace.warmPdfjs` member access.
function isWarmupRef(node, bound) {
  if (node.type === 'Identifier') return bound.names.has(node.name);
  return node.type === 'MemberExpression'
    && !node.computed
    && node.object.type === 'Identifier'
    && bound.namespaces.has(node.object.name)
    && node.property.type === 'Identifier'
    && node.property.name === WARMUP_IMPORT_NAME;
}

// Whether a beforeAll registration runs before the suite: anything under a
// skipped/todo block, inside a test, or inside another hook never executes
// (or fails loudly instead of warming). Registrations at the top level or
// inside an executing describe block run.
function executesRegistration(ancestors) {
  for (const ancestor of ancestors) {
    if (ancestor.type !== 'CallExpression') continue;
    const callee = ancestor.callee;
    if (callee.type === 'MemberExpression') {
      const property = !callee.computed && callee.property.type === 'Identifier'
        ? callee.property.name
        : '';
      if (property === 'skip' || property === 'todo') return false;
      if (callee.object.type === 'Identifier'
        && (callee.object.name === 'it' || callee.object.name === 'test')) return false;
    } else if (callee.type === 'Identifier') {
      if (/^x(describe|it|test)$/.test(callee.name)) return false;
      if (callee.name === 'it' || callee.name === 'test') return false;
    }
  }
  return true;
}

function bindsName(pattern, name) {
  if (!pattern || typeof pattern.type !== 'string') return false;
  if (pattern.type === 'Identifier') return pattern.name === name;
  if (pattern.type === 'AssignmentPattern') return bindsName(pattern.left, name);
  if (pattern.type === 'RestElement') return bindsName(pattern.argument, name);
  if (pattern.type === 'ArrayPattern') return pattern.elements.some((entry) => bindsName(entry, name));
  if (pattern.type === 'ObjectPattern') {
    return pattern.properties.some((entry) => bindsName(entry.value || entry.argument, name));
  }
  return false;
}

// Whether an expression is the warm-up promise itself: a call to the import
// (optionally awaited or chained with .then), so the hook settles only after
// the pdf.js import resolves. Anything else — a bare call whose result is
// dropped, a variable holding the promise — leaves the suite racing the import.
function resolvesToWarmupCall(node, bound) {
  if (!node || typeof node.type !== 'string') return false;
  if (node.type === 'AwaitExpression') return resolvesToWarmupCall(node.argument, bound);
  if (node.type === 'ChainExpression') return resolvesToWarmupCall(node.expression, bound);
  if (node.type !== 'CallExpression') return false;
  const callee = node.callee;
  if (callee.type === 'ChainExpression') return resolvesToWarmupCall(callee.expression, bound);
  if (isWarmupRef(callee, bound)) return true;
  if (callee.type === 'MemberExpression') return resolvesToWarmupCall(callee.object, bound);
  return false;
}

// A same-named parameter or own-body declaration would shadow the import
// inside the callback. Deeper shadowing (a sibling declaration in an
// enclosing block) is out of scope: it cannot occur without deliberately
// adversarial code, and the suite would fail loudly at runtime anyway.
function callbackShadowsImport(fn, bound) {
  const shadowed = (name) => fn.params.some((param) => bindsName(param, name))
    || (fn.body.type === 'BlockStatement' && fn.body.body.some((statement) => (
      (statement.type === 'VariableDeclaration'
        && statement.declarations.some((declarator) => bindsName(declarator.id, name)))
      || ((statement.type === 'FunctionDeclaration' || statement.type === 'ClassDeclaration')
        && statement.id !== null
        && statement.id.name === name)
    )));
  return [...bound.names].some(shadowed);
}

// Whether a beforeAll callback returns or awaits the warm-up call, without
// crossing into nested functions (a call hidden in a nested callback floats).
function callbackWarmsUp(fn, bound) {
  if (callbackShadowsImport(fn, bound)) return false;
  if (fn.body.type !== 'BlockStatement') return resolvesToWarmupCall(fn.body, bound);
  let warmed = false;
  const visit = (node) => {
    if (warmed || !node || typeof node.type !== 'string') return;
    if (node.type === 'ArrowFunctionExpression'
      || node.type === 'FunctionExpression'
      || node.type === 'FunctionDeclaration') return;
    if (node.type === 'ReturnStatement') {
      if (node.argument && resolvesToWarmupCall(node.argument, bound)) warmed = true;
    } else if (node.type === 'AwaitExpression') {
      if (resolvesToWarmupCall(node.argument, bound)) warmed = true;
    }
    for (const child of childNodes(node)) visit(child);
  };
  visit(fn.body);
  return warmed;
}

// Whether the suite source registers an executed beforeAll that settles
// only after the real pdf.js warm-up import resolves.
export function suiteOptsIntoWarmup(source) {
  const program = parseProgram(source);
  if (!program) return false;
  const bound = warmupBindings(program);
  if (bound.names.size === 0 && bound.namespaces.size === 0) return false;
  const registrations = [];
  const visit = (node, ancestors) => {
    if (node.type === 'CallExpression'
      && node.callee.type === 'Identifier'
      && node.callee.name === SETUP_HOOK) {
      registrations.push({ node, ancestors: [...ancestors] });
    }
    for (const child of childNodes(node)) visit(child, [...ancestors, node]);
  };
  visit(program, []);
  return registrations.some(({ node, ancestors }) => {
    if (!executesRegistration(ancestors)) return false;
    const [first] = node.arguments;
    if (!first) return false;
    if (isWarmupRef(first, bound)) {
      return !ancestors.some((ancestor) => (
        (ancestor.type === 'ArrowFunctionExpression'
          || ancestor.type === 'FunctionExpression'
          || ancestor.type === 'FunctionDeclaration')
        && [...bound.names].some((name) => ancestor.params.some((param) => bindsName(param, name))))
      );
    }
    return (first.type === 'ArrowFunctionExpression' || first.type === 'FunctionExpression')
      && callbackWarmsUp(first, bound);
  });
}

function isOptionsLoadPdfjs(node) {
  if (!node || node.type !== 'MemberExpression') return false;
  if (node.object.type !== 'Identifier' || node.object.name !== OPTIONS_OBJECT) return false;
  if (!node.computed) {
    return node.property.type === 'Identifier' && node.property.name === LOAD_PDFJS;
  }
  return node.property.type === 'Literal' && node.property.value === LOAD_PDFJS;
}

function staticImportSource(node) {
  let current = node;
  while (current && (current.type === 'AwaitExpression' || current.type === 'ChainExpression')) {
    current = current.type === 'AwaitExpression' ? current.argument : current.expression;
  }
  if (current
    && current.type === 'ImportExpression'
    && current.source
    && current.source.type === 'Literal'
    && typeof current.source.value === 'string') {
    return current.source.value;
  }
  return null;
}

// Whether a function is a static default loader: its body resolves to a
// static import() of a literal specifier, whether written as an expression
// body, a block with a return, async, or chained. Dynamic specifiers and
// non-function fallbacks are not readable defaults.
function loaderSpecifier(node) {
  if (!node
    || (node.type !== 'ArrowFunctionExpression' && node.type !== 'FunctionExpression')) return null;
  if (node.body.type !== 'BlockStatement') return staticImportSource(node.body);
  let specifier = null;
  const visit = (current) => {
    if (specifier || !current || typeof current.type !== 'string') return;
    if (current.type === 'ArrowFunctionExpression'
      || current.type === 'FunctionExpression'
      || current.type === 'FunctionDeclaration') return;
    if (current.type === 'ReturnStatement' && current.argument) {
      specifier = staticImportSource(current.argument);
    }
    for (const child of childNodes(current)) visit(child);
  };
  visit(node.body);
  return specifier;
}

// Read the comparator's default loadPdfjs specifier from the AST: the
// fallback behind `options.loadPdfjs ?? <loader>` (or an equivalent `||` or
// conditional), whatever its formatting. Null when no static default exists.
export function readComparatorDefaultLoad(source) {
  const program = parseProgram(source);
  if (!program) return null;
  // The declaration lives inside createRenderComparator, so walk the whole
  // tree in source order instead of only the top level.
  const declarations = [];
  const visit = (node) => {
    if (node.type === 'VariableDeclaration') {
      for (const declarator of node.declarations) declarations.push(declarator);
    }
    for (const child of childNodes(node)) visit(child);
  };
  visit(program);
  for (const declarator of declarations) {
    if (declarator.id.type !== 'Identifier'
      || declarator.id.name !== LOAD_PDFJS
      || !declarator.init) continue;
    const init = declarator.init;
    if (init.type === 'LogicalExpression'
      && (init.operator === '??' || init.operator === '||')
      && isOptionsLoadPdfjs(init.left)) {
      return loaderSpecifier(init.right);
    }
    if (init.type === 'ConditionalExpression' && isOptionsLoadPdfjs(init.test)) {
      if (isOptionsLoadPdfjs(init.consequent)) return loaderSpecifier(init.alternate);
      if (isOptionsLoadPdfjs(init.alternate)) return loaderSpecifier(init.consequent);
      return null;
    }
    return loaderSpecifier(init);
  }
  return null;
}
