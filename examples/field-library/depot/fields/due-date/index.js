// A due-date field.
//
// Note what the imports say: `date-fns` and `zod`, the bare specifiers any
// npm-shaped source writes. Neither is a deck name — the decks are
// `lib/date-fns` and `lib/zod`. package.json aliases them:
//
//     "date-fns": "lib/date-fns@^4.1.0"
//      ^ the import specifier    ^ the deck that answers to it
//
// so this file never has to know the depot's naming, and the deck never has
// to be named after the specifier. That is the whole of aliasing.
//
// The subpath imports are deliberate. date-fns@4 publishes 304 modules and
// its entry re-exports all of them; asking for `date-fns/format.js` pulls in
// three. The `date-fns/` prefix entry in this deck's scope is what makes a
// subpath resolve at all.
import { format } from 'date-fns/format.js';
import { differenceInCalendarDays } from 'date-fns/differenceInCalendarDays.js';
import { parseISO } from 'date-fns/parseISO.js';
import * as zodNs from 'zod';

const { z } = zodNs;

const schema = z.object({
  due: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD'),
  note: z.string().max(80).optional(),
});

export const field = {
  name: 'DueDate',
  summary: 'A calendar date, rendered relative to today.',
  library: 'date-fns',
  schema,
  // The module NAMESPACE objects this field holds, keyed by the specifier
  // it imported them under. The page compares them across fields: two decks
  // that resolve one specifier to one URL hold the identical object, and two
  // that resolve it to different URLs do not. See library.js.
  modules: { zod: zodNs },
  examples: [
    { due: '2026-08-14', note: 'invoice 3391' },
    { due: '2026-07-30', note: 'expired trial' },
    { due: '2027-01-01' },
  ],
  format(value, today = new Date()) {
    let date = parseISO(value.due);
    let days = differenceInCalendarDays(date, today);
    let when =
      days === 0
        ? 'today'
        : days > 0
          ? `in ${days} day${days === 1 ? '' : 's'}`
          : `${-days} day${days === -1 ? '' : 's'} ago`;
    return `${format(date, 'EEE d MMM yyyy')} · ${when}`;
  },
  tone(value, today = new Date()) {
    let days = differenceInCalendarDays(parseISO(value.due), today);
    return days < 0 ? 'overdue' : days <= 7 ? 'soon' : 'ok';
  },
};
