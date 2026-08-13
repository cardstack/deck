// The one field on this page that you own.
//
// It is an ordinary deck. It imports `date-fns` and `zod` by the bare
// specifiers npm-shaped source already writes; package.json says which
// decks answer to those names. Nothing about this
// file knows it is editable.
//
// The page beside it writes this file to disk when you press Save. From
// there the ordinary loop takes over: the watcher waits for quiet, hashes
// the tree, and publishes the result as `1.0.0-dev.N`. Every version you
// make stays at its own address for ever, including the ones you regret.
import { differenceInCalendarDays } from 'date-fns/differenceInCalendarDays.js';
import { format } from 'date-fns/format.js';
import { parseISO } from 'date-fns/parseISO.js';
import * as zodNs from 'zod';

const { z } = zodNs;

// Anything inside this many days counts as "soon".
const WARN_DAYS = 7;

export const field = {
  name: 'ShipBy',
  summary: 'The day the crate has to leave the warehouse.',
  library: 'date-fns',
  schema: z.object({
    ship: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD'),
  }),
  modules: { zod: zodNs },
  examples: [{ ship: '2026-09-20' }],

  format(value, today = new Date()) {
    let date = parseISO(value.ship);
    return format(date, 'EEE d MMM yyyy');
  },

  tone(value, today = new Date()) {
    let days = differenceInCalendarDays(parseISO(value.ship), today);
    if (days < 0) return 'late';
    if (days <= WARN_DAYS) return 'soon';
    return 'ok';
  },

  // A fill from 0 to 1 can go here. The form draws a bar when it finds one.
};
