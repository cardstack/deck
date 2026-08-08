// A meeting slot: an instant plus the zone it was agreed in.
//
// Uses luxon, not date-fns, because zones are the whole point and luxon
// carries a real zone model. Two libraries that do overlapping jobs, both
// vendored, both sealed, chosen per field — which is the ordinary state of a
// codebase and not a problem to be solved.
import * as luxonNs from 'luxon';
import * as zodNs from 'zod';

const { DateTime } = luxonNs;
const { z } = zodNs;

const schema = z.object({
  start: z.string(),
  zone: z.string(),
  minutes: z.number().int().positive().max(480),
});

export const field = {
  name: 'MeetingSlot',
  summary: 'A start instant, a duration, and the zone it was agreed in.',
  library: 'luxon',
  schema,
  modules: { zod: zodNs, luxon: luxonNs },
  examples: [
    { start: '2026-08-12T09:30:00', zone: 'Europe/London', minutes: 45 },
    { start: '2026-08-12T09:30:00', zone: 'Asia/Singapore', minutes: 30 },
    { start: '2026-08-12T09:30:00', zone: 'America/New_York', minutes: 60 },
  ],
  format(value) {
    let start = DateTime.fromISO(value.start, { zone: value.zone });
    let end = start.plus({ minutes: value.minutes });
    return `${start.toFormat('ccc d LLL, HH:mm')}–${end.toFormat('HH:mm')} ${start.offsetNameShort}`;
  },
  // The same wall-clock time in three zones is three different instants.
  // Rendering it in the reader's zone is the thing every home-grown date
  // field gets wrong.
  inZone(value, zone) {
    return DateTime.fromISO(value.start, { zone: value.zone })
      .setZone(zone)
      .toFormat('ccc d LLL, HH:mm');
  },
  utc(value) {
    return DateTime.fromISO(value.start, { zone: value.zone })
      .toUTC()
      .toISO({ suppressMilliseconds: true });
  },
};
