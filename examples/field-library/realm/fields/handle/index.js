// A short public handle: a human prefix plus enough entropy to be unique.
//
// Two modules. nanoid is the smallest thing in the library shelf, and it is
// here to make a point about cost: a 2-module dependency and a 304-module
// one are the same amount of ceremony, because the unit is a deck and the
// store deduplicates the bytes.
import * as nanoidNs from 'nanoid';
import * as zodNs from 'zod';

const { customAlphabet } = nanoidNs;
const { z } = zodNs;

const ALPHABET = '23456789abcdefghjkmnpqrstuvwxyz';
const suffix = customAlphabet(ALPHABET, 8);

const schema = z.object({
  prefix: z
    .string()
    .min(2)
    .max(12)
    .regex(/^[a-z][a-z0-9-]*$/, 'lowercase, starts with a letter'),
  id: z.string().regex(new RegExp(`^[${ALPHABET}]{8}$`), '8 unambiguous chars'),
});

export const field = {
  name: 'Handle',
  summary: 'A readable prefix plus 8 unambiguous characters.',
  library: 'nanoid',
  schema,
  modules: { zod: zodNs, nanoid: nanoidNs },
  examples: [{ prefix: 'invoice' }, { prefix: 'run' }, { prefix: 'card' }],
  // The examples carry no id, so the page mints one — the only genuinely
  // non-deterministic thing in this realm. Everything else on the page is a
  // pure function of sealed bytes.
  mint(value) {
    return { ...value, id: value.id ?? suffix() };
  },
  format(value) {
    let minted = this.mint(value);
    return `${minted.prefix}-${minted.id}`;
  },
};
