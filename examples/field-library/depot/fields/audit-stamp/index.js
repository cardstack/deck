// Who changed what, when. Three dependencies, and this deck shares every one
// of them with another field on the page:
//
//     luxon   also in fields/meeting-slot
//     nanoid  also in fields/handle
//     zod     in all six
//
// None of that is coordinated. Each deck declared what it wanted, the ranges
// happened to resolve to the same versions, and the result is one URL per
// library — so one copy in the store, one fetch, one module instance.
// Dedupe here is an OUTCOME of content addressing, not a pass over a graph.
import * as luxonNs from 'luxon';
import * as nanoidNs from 'nanoid';
import * as zodNs from 'zod';

const { DateTime } = luxonNs;
const { nanoid } = nanoidNs;
const { z } = zodNs;

const schema = z.object({
  actor: z.string().min(1),
  action: z.enum(['created', 'updated', 'sealed', 'forked']),
  at: z.string(),
  trace: z.string().optional(),
});

export const field = {
  name: 'AuditStamp',
  summary: 'An actor, an action, an instant, and a trace id.',
  library: 'luxon + nanoid',
  schema,
  modules: { zod: zodNs, luxon: luxonNs, nanoid: nanoidNs },
  examples: [
    { actor: 'ana', action: 'created', at: '2026-08-06T11:04:00Z' },
    { actor: 'kim', action: 'updated', at: '2026-08-07T16:22:00Z' },
    { actor: 'rebase-daemon', action: 'sealed', at: '2026-08-08T02:00:00Z' },
  ],
  stamp(value) {
    return { ...value, trace: value.trace ?? nanoid(10) };
  },
  format(value) {
    let stamped = this.stamp(value);
    let when = DateTime.fromISO(stamped.at, { zone: 'utc' });
    return `${stamped.actor} ${stamped.action} · ${when.toFormat("d LLL yyyy HH:mm 'UTC'")} · ${stamped.trace}`;
  },
};
