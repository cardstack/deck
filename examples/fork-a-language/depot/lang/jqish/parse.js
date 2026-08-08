// jqish — the PARSER. This is the module the fork replaces.
//
// A small, real jq-shaped filter language: paths, pipes, a select() with
// comparisons, and boolean operators spelled the way jq spells them.
//
//   .items | select(.qty > 2 and .tag == "book") | .title
//
// It produces an AST that `eval.js` executes. Keeping the parser in its own
// module is the entire reason a fork can change the SYNTAX without touching
// the semantics — and that separation is not a favour to Deck, it is
// ordinary good structure that Deck then makes cheap to exploit.

export const DIALECT = {
  name: 'jqish',
  tagline: 'jq-shaped: C-style operators, pipes',
  sample: '.items | select(.qty > 2 and .tag == "book") | .title',
};

const TOKEN =
  /\s*(?:(\|)|(\()|(\))|(,)|(>=|<=|==|!=|>|<)|(\band\b|\bor\b|\bnot\b)|(\bselect\b|\bmap\b|\blength\b)|(-?\d+(?:\.\d+)?)|"([^"]*)"|(\.[A-Za-z_][A-Za-z0-9_]*|\.)|([A-Za-z_][A-Za-z0-9_]*))/y;

export function tokenize(source) {
  let tokens = [];
  let at = 0;
  while (at < source.length) {
    TOKEN.lastIndex = at;
    let m = TOKEN.exec(source);
    if (!m) {
      if (!source.slice(at).trim()) break;
      throw new SyntaxError(`jqish: cannot read ${JSON.stringify(source.slice(at, at + 12))}`);
    }
    at = TOKEN.lastIndex;
    let [, pipe, lp, rp, comma, cmp, bool, fn, num, str, path, word] = m;
    if (pipe) tokens.push({ t: 'pipe' });
    else if (lp) tokens.push({ t: '(' });
    else if (rp) tokens.push({ t: ')' });
    else if (comma) tokens.push({ t: ',' });
    else if (cmp) tokens.push({ t: 'cmp', v: cmp });
    else if (bool) tokens.push({ t: 'bool', v: bool });
    else if (fn) tokens.push({ t: 'fn', v: fn });
    else if (num !== undefined) tokens.push({ t: 'lit', v: Number(num) });
    else if (str !== undefined) tokens.push({ t: 'lit', v: str });
    else if (path) tokens.push({ t: 'path', v: path === '.' ? [] : [path.slice(1)] });
    else if (word) tokens.push({ t: 'lit', v: word === 'true' ? true : word === 'false' ? false : word });
  }
  return tokens;
}

// Pipeline := Stage ('|' Stage)*
export function parse(source) {
  let tokens = tokenize(source);
  let i = 0;
  const peek = () => tokens[i];
  const eat = (t) => {
    if (tokens[i]?.t !== t) throw new SyntaxError(`jqish: expected ${t}`);
    return tokens[i++];
  };

  function pipeline() {
    let stages = [stage()];
    while (peek()?.t === 'pipe') {
      i++;
      stages.push(stage());
    }
    return stages.length === 1 ? stages[0] : { k: 'pipe', stages };
  }

  function stage() {
    let tok = peek();
    if (tok?.t === 'fn') {
      i++;
      if (tok.v === 'length') return { k: 'length' };
      eat('(');
      let inner = tok.v === 'select' ? predicate() : pipeline();
      eat(')');
      return { k: tok.v, inner };
    }
    if (tok?.t === 'path') {
      i++;
      return { k: 'path', path: tok.v };
    }
    throw new SyntaxError(`jqish: unexpected ${tok ? tok.t : 'end of input'}`);
  }

  // or < and < not < comparison
  function predicate() {
    let left = andExpr();
    while (peek()?.t === 'bool' && peek().v === 'or') {
      i++;
      left = { k: 'or', left, right: andExpr() };
    }
    return left;
  }
  function andExpr() {
    let left = unary();
    while (peek()?.t === 'bool' && peek().v === 'and') {
      i++;
      left = { k: 'and', left, right: unary() };
    }
    return left;
  }
  function unary() {
    if (peek()?.t === 'bool' && peek().v === 'not') {
      i++;
      return { k: 'not', inner: unary() };
    }
    if (peek()?.t === '(') {
      i++;
      let inner = predicate();
      eat(')');
      return inner;
    }
    return comparison();
  }
  function comparison() {
    let left = operand();
    if (peek()?.t === 'cmp') {
      let op = tokens[i++].v;
      return { k: 'cmp', op, left, right: operand() };
    }
    return left;
  }
  function operand() {
    let tok = tokens[i++];
    if (tok?.t === 'path') return { k: 'path', path: tok.v };
    if (tok?.t === 'lit') return { k: 'lit', v: tok.v };
    throw new SyntaxError(`jqish: expected a value, got ${tok ? tok.t : 'end of input'}`);
  }

  let ast = pipeline();
  if (i !== tokens.length) throw new SyntaxError(`jqish: trailing input`);
  return ast;
}
