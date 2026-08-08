// The engine: parse, then evaluate. A consumer imports only this.
import { parse, DIALECT } from './parse.js';
import { evaluate } from './eval.js';

export { DIALECT };
export function run(source, input) {
  return evaluate(parse(source), input);
}
