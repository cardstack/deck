// FEEL-ish — the FORKED parser. This is the ONLY file that differs from
// lang/jqish, and it is a whole surface language.
//
// jqish spells a filter the way jq does:
//
//     .items | select(.qty > 2 and .tag == "book") | .title
//
// This one spells it the way FEEL (the DMN decision language) does — list
// filters in brackets, `=` for equality, unquoted paths:
//
//     items[qty > 2 and tag = "book"].title
//
// It also ADDS something jqish does not have: FEEL ranges.
//
//     items[qty in [2..8]].title
//
// The range is the interesting part. It compiles to `qty >= 2 and qty <= 8`
// — a desugaring, entirely inside the parser — so a new language feature
// arrives with the evaluator UNCHANGED. `eval.js` is byte-identical between
// the two decks, which means the store holds exactly one copy of it and
// both dialects are provably running the same semantics.

export const DIALECT = {
  name: 'feelish',
  tagline: 'FEEL-shaped: bracket filters, `=` equality, ranges',
  sample: 'items[qty > 2 and tag = "book"].title',
};

const TOKEN =
  /\s*(?:(\[)|(\])|(\()|(\))|(\.\.)|(\.)|(>=|<=|!=|=|>|<)|(\band\b|\bor\b|\bnot\b|\bin\b)|(\bcount\b)|(-?\d+(?:\.\d+)?)|"([^"]*)"|([A-Za-z_][A-Za-z0-9_]*))/y;

export function tokenize(source) {
  let tokens = [];
  let at = 0;
  while (at < source.length) {
    TOKEN.lastIndex = at;
    let m = TOKEN.exec(source);
    if (!m) {
      if (!source.slice(at).trim()) break;
      throw new SyntaxError(`feelish: cannot read ${JSON.stringify(source.slice(at, at + 12))}`);
    }
    at = TOKEN.lastIndex;
    let [, lb, rb, lp, rp, dotdot, dot, cmp, kw, count, num, str, name] = m;
    if (lb) tokens.push({ t: '[' });
    else if (rb) tokens.push({ t: ']' });
    else if (lp) tokens.push({ t: '(' });
    else if (rp) tokens.push({ t: ')' });
    else if (dotdot) tokens.push({ t: '..' });
    else if (dot) tokens.push({ t: '.' });
    else if (cmp) tokens.push({ t: 'cmp', v: cmp === '=' ? '==' : cmp });
    else if (kw) tokens.push({ t: 'kw', v: kw });
    else if (count) tokens.push({ t: 'count' });
    else if (num !== undefined) tokens.push({ t: 'lit', v: Number(num) });
    else if (str !== undefined) tokens.push({ t: 'lit', v: str });
    else tokens.push({ t: 'name', v: name });
  }
  return tokens;
}

// Expr := count(Expr) | Path ( '[' Predicate ']' )? ( '.' name )*
export function parse(source) {
  let tokens = tokenize(source);
  let i = 0;
  const peek = () => tokens[i];
  const eat = (t) => {
    if (tokens[i]?.t !== t) throw new SyntaxError(`feelish: expected ${t}`);
    return tokens[i++];
  };

  function expression() {
    if (peek()?.t === 'count') {
      i++;
      eat('(');
      let inner = expression();
      eat(')');
      return { k: 'pipe', stages: [inner, { k: 'length' }] };
    }
    // A leading name is the first path segment: `items` not `.items`.
    let head = eat('name');
    let stages = [{ k: 'path', path: [head.v] }];
    for (;;) {
      if (peek()?.t === '[') {
        i++;
        stages.push({ k: 'select', inner: predicate() });
        eat(']');
        continue;
      }
      if (peek()?.t === '.' && tokens[i + 1]?.t === 'name') {
        i++;
        stages.push({ k: 'path', path: [eat('name').v] });
        continue;
      }
      break;
    }
    return stages.length === 1 ? stages[0] : { k: 'pipe', stages };
  }

  function predicate() {
    let left = andExpr();
    while (peek()?.t === 'kw' && peek().v === 'or') {
      i++;
      left = { k: 'or', left, right: andExpr() };
    }
    return left;
  }
  function andExpr() {
    let left = unary();
    while (peek()?.t === 'kw' && peek().v === 'and') {
      i++;
      left = { k: 'and', left, right: unary() };
    }
    return left;
  }
  function unary() {
    if (peek()?.t === 'kw' && peek().v === 'not') {
      i++;
      eat('(');
      let inner = predicate();
      eat(')');
      return { k: 'not', inner };
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
    // FEEL ranges: `qty in [2..8]`. DESUGARED here into the two comparisons
    // the evaluator already understands, so the new syntax costs no change
    // to eval.js — which is exactly why both decks share that file.
    if (peek()?.t === 'kw' && peek().v === 'in') {
      i++;
      eat('[');
      let lo = operand();
      eat('..');
      let hi = operand();
      eat(']');
      return {
        k: 'and',
        left: { k: 'cmp', op: '>=', left, right: lo },
        right: { k: 'cmp', op: '<=', left, right: hi },
      };
    }
    if (peek()?.t === 'cmp') {
      let op = tokens[i++].v;
      return { k: 'cmp', op, left, right: operand() };
    }
    return left;
  }
  function operand() {
    let tok = tokens[i++];
    if (tok?.t === 'name') return { k: 'path', path: [tok.v] };
    if (tok?.t === 'lit') return { k: 'lit', v: tok.v };
    throw new SyntaxError(`feelish: expected a value, got ${tok ? tok.t : 'end of input'}`);
  }

  let ast = expression();
  if (i !== tokens.length) throw new SyntaxError(`feelish: trailing input`);
  return ast;
}
