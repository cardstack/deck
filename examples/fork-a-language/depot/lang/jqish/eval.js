// jqish — the EVALUATOR. The fork does NOT touch this file.
//
// That is the point of the demo: the AST is the contract between syntax and
// semantics, so a fork can replace the whole surface language and still be
// running byte-identical evaluation. In the store, this file is one object
// shared by both decks.

function get(value, path) {
  return path.reduce((v, key) => (v == null ? undefined : v[key]), value);
}

const COMPARE = {
  '==': (a, b) => a === b,
  '!=': (a, b) => a !== b,
  '>': (a, b) => a > b,
  '<': (a, b) => a < b,
  '>=': (a, b) => a >= b,
  '<=': (a, b) => a <= b,
};

function truth(node, item) {
  switch (node.k) {
    case 'and': return truth(node.left, item) && truth(node.right, item);
    case 'or': return truth(node.left, item) || truth(node.right, item);
    case 'not': return !truth(node.inner, item);
    case 'cmp': return COMPARE[node.op](value(node.left, item), value(node.right, item));
    default: return Boolean(value(node, item));
  }
}

function value(node, item) {
  if (node.k === 'lit') return node.v;
  if (node.k === 'path') return get(item, node.path);
  return undefined;
}

export function evaluate(ast, input) {
  switch (ast.k) {
    case 'pipe': return ast.stages.reduce((v, stage) => evaluate(stage, v), input);
    case 'path': return Array.isArray(input) && ast.path.length
      ? input.map((item) => get(item, ast.path))
      : get(input, ast.path);
    case 'length': return Array.isArray(input) ? input.length : Object.keys(input ?? {}).length;
    case 'select': return (Array.isArray(input) ? input : [input]).filter((item) => truth(ast.inner, item));
    case 'map': return (Array.isArray(input) ? input : [input]).map((item) => evaluate(ast.inner, item));
    default: throw new Error(`jqish: cannot evaluate ${ast.k}`);
  }
}
