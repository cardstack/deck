// What an agent is doing, and what it did.
//
// Two records, one per tense, and the difference between them is the whole
// design (docs/deck-activity-protocol.md §3):
//
//   claim   INTENT.  "I am working here." Ephemeral, TTL, expires by itself.
//   note    RECORD.  "Here is what I did." Permanent, sealed, addressable.
//
// They are stored in different places for that reason, not by accident:
//
//   a claim refreshes every half hour and would churn a tree hash each time,
//   so it lives in `.deck/` — depot machinery, outside every tree, ignored by
//   git, gone on a wipe. It is not history and must never look like it.
//
//   a note IS content. It is bytes in a deck, so it hashes, seals, versions,
//   forks, diffs and endorses like anything else, with no second format to
//   teach and no bespoke endpoint to serve it. When these are backported to
//   the realm server, each note file is already a card instance.
//
// WHY THE CLI WRITES BOTH, AND NOT AN HTTP POST. The server answers GET and
// HEAD and nothing else. That rule is worth more than the convenience of a
// write endpoint — it is what makes an address a promise rather than an API.
// Every change to a depot goes through the CLI or the watcher, including
// these; the server reads what is on disk. An agent editing a depot already
// runs `deck`, so declaring itself needs no token, no port and no CORS.
//
// A NOTE IS THE OTHER HALF OF A COMMIT. Git fuses the tree and the story
// about the tree into one object: `(tree, parents, author, time, message)`.
// Deck already separates them — the seal log holds tree and parents — which
// leaves author, time and message with nowhere to live. That is what this is.
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import {
  CLAIM_DEFAULT_TTL_MS,
  CLAIM_MAX_TTL_MS,
  claimsDirFor,
} from '@cardstack/deck-server/activity';
import { defineCommand, type Command } from '../command.ts';
import { depotAt, fail } from '../support.ts';

/** `30m`, `2h`, `90s`, or bare seconds. */
function parseTtl(input: string | undefined): number {
  if (!input) return CLAIM_DEFAULT_TTL_MS;
  let match = /^(\d+)\s*([smh]?)$/.exec(input.trim());
  if (!match) fail(`--ttl wants something like 30m, 2h or 90s — got "${input}"`);
  let value = Number(match[1]);
  let unit = match[2] || 's';
  let ms = value * (unit === 'h' ? 3600_000 : unit === 'm' ? 60_000 : 1000);
  return Math.min(ms, CLAIM_MAX_TTL_MS);
}

/**
 * Who is speaking.
 *
 * An unattributed claim is worse than no claim: the whole point of the
 * channel is telling two workers apart, and "somebody is editing this" is
 * information nobody can act on. `DECK_ACTOR` exists so an agent sets it once
 * in its environment rather than threading a flag through every call.
 */
function actorFrom(explicit: string | undefined): string {
  let actor = explicit ?? process.env.DECK_ACTOR ?? '';
  if (!actor) {
    fail('who is claiming? pass --actor <name> or set DECK_ACTOR');
  }
  if (!/^[a-z0-9][a-z0-9._-]*$/i.test(actor)) {
    fail(`--actor must be a plain name — got "${actor}"`);
  }
  return actor;
}

// ONE FILE PER ACTOR, never a shared array: two agents appending to
// `claims.json` is a lost update, two agents writing `claims/a.json` and
// `claims/b.json` is a set union. The codelist demo's argument, turned on
// this repo's own machinery. The directory itself comes from the server so
// the writer and the reader cannot disagree about where it is.

const claim = defineCommand({
  name: 'claim',
  group: 'say',
  summary: 'declare what you are working on, so others can see it coming',
  usage: [
    'claim <path> [--depot <dir>] [--actor <who>] [--text <why>] [--ttl 30m]',
    'claim --clear [--depot <dir>] [--actor <who>]',
    'claim --status [--depot <dir>] [--actor <who>]',
  ],
  detail: `A claim is INTENT, not history. It says "I am working here" and
expires on its own, so a crashed agent leaves no ghost — the reader enforces
expiry, because a process that dies cannot clean up after itself.

It never moves the activity score. Touch (what changed) and claim (what was
declared) are two channels and blending them would make "how much work landed
here" something an agent could inflate by announcing itself. The most useful
state on screen is a claim with no changes yet: work about to happen.

A claim is made by whoever is about to work — an agent, or a person saying
"I am editing this, I am going to change it". The path can be a file, a
folder, a deck or a whole tree; anything addressable.

DELETING SOMEONE'S CLAIM IS AN INSTRUCTION, NOT HOUSEKEEPING. If a human
removes an agent's claim before it expires, that means "stop working here" —
and the absence of the file is the whole message, so revocation needs no
second channel and no permission model beyond who can write the directory.

Which is why --status exists, and why it distinguishes two ways of being
gone. An agent polls it and reads the exit code:

    0  held      still yours; carry on
    3  REVOKED   gone before its TTL — somebody took it. Stop.
    4  expired   ran out on its own. Refresh if still working.

Telling those apart is the entire point: an agent that treats expiry as a
stop signal gives up for no reason, and one that treats revocation as expiry
ignores the person asking it to stop.

Written to <depot>/.deck/claims/<actor>.json — machinery, not content, so it
is outside every tree and can never move a tree hash. One live claim per
actor: an agent that could claim five places at once could make a whole depot
look busy without doing anything.`,
  async run(argv) {
    let { values, positionals } = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        depot: { type: 'string', default: '.' },
        actor: { type: 'string' },
        text: { type: 'string' },
        ttl: { type: 'string' },
        clear: { type: 'boolean', default: false },
        status: { type: 'boolean', default: false },
      },
    });
    let depot = depotAt(resolve(values.depot ?? '.'));
    let actor = actorFrom(values.actor);
    let file = join(claimsDirFor(depot.dir), `${actor}.json`);

    if (values.status) {
      let held = await readFile(file, 'utf8')
        .then((raw) => JSON.parse(raw) as { prefix?: string; until?: number })
        .catch(() => undefined);
      if (held?.until && held.until > Date.now()) {
        let left = Math.round((held.until - Date.now()) / 60000);
        console.log(`held ${held.prefix} — ${left}m left`);
        return;
      }
      // Gone, and the reason matters. A file that vanished before its own
      // deadline was taken; one that reached it merely lapsed. The record of
      // when it should have ended is what tells them apart, so the last
      // known deadline is remembered beside the claim.
      let mark = await readFile(`${file}.until`, 'utf8').catch(() => undefined);
      let deadline = Number(mark);
      if (!held && Number.isFinite(deadline) && deadline > Date.now()) {
        console.error(
          `revoked — your claim was removed before it expired. Stop working here.`,
        );
        process.exit(3);
      }
      console.log('expired — refresh the claim if you are still working');
      process.exit(4);
    }

    if (values.clear) {
      await rm(file, { force: true });
      console.log(`cleared ${actor}'s claim on ${depot.name}`);
      return;
    }

    let [prefix] = positionals;
    if (!prefix) fail('usage: deck claim <prefix>  (e.g. deck claim app/run)');
    let now = Date.now();
    let ttl = parseTtl(values.ttl);
    // Refreshing the same prefix keeps the original start, so "claimed for 40
    // minutes" stays true across heartbeats. Moving elsewhere is a new claim
    // and the clock restarts, which is what a move means.
    let previous = await readFile(file, 'utf8')
      .then((raw) => JSON.parse(raw) as { prefix?: string; since?: number })
      .catch(() => undefined);
    let clean = prefix.replace(/^\/+/, '').replace(/\/+$/, '');
    let record = {
      actor,
      prefix: clean,
      since: previous?.prefix === clean ? (previous.since ?? now) : now,
      until: now + ttl,
      ...(values.text ? { text: values.text } : {}),
    };
    await mkdir(claimsDirFor(depot.dir), { recursive: true });
    await writeFile(file, `${JSON.stringify(record, null, 2)}\n`);
    // The deadline outlives the claim on purpose: once the claim file is
    // gone, this is the only evidence of whether it was taken or ran out.
    await writeFile(`${file}.until`, String(record.until));
    console.log(
      `${actor} claimed /${depot.name}/${clean} for ${Math.round(ttl / 60000)}m`,
    );
  },
});

/**
 * ADDRESSES INSIDE A NOTE ARE DEPOT-RELATIVE, and that is not a detail.
 *
 * A depot's mount name belongs to the SERVER, not to the depot: the same
 * directory is `site` to one process and `codelist` to another. Writing the
 * mount name into content freezes a serving decision into bytes that outlive
 * it — which is precisely how all nine demos ended up with `/site/` pins that
 * resolved nowhere once the Hub mounted them under their own names.
 *
 * `depotAt()` derives the name from the directory basename, so a depot in a
 * folder called `depot` would have stamped `/depot/kim/notes/…` into every
 * reply. Relative addresses cannot be wrong that way: they are resolved
 * against whichever depot is doing the reading, which is the only depot that
 * knows what it is called.
 */
function depotRelative(address: string, depotName: string): string {
  let clean = String(address).replace(/^\/+/, '');
  return clean.startsWith(`${depotName}/`) ? clean.slice(depotName.length + 1) : clean;
}

/**
 * A note names its subject by TREE HASH, like an endorsement (L9).
 *
 * Same reason: a fork of the same bytes reads the same notes, and a rename or
 * a re-publish does not orphan the story. The human-readable `at` rides along
 * for display; the hash is what joins.
 */
const note = defineCommand({
  name: 'note',
  group: 'say',
  summary: 'record what you did — a group update about a tree',
  usage: [
    'note --text <what> [--tree <hash>] [--at <address>] [--depot <dir>]',
    '     [--actor <who>] [--kind update|comment]',
    'note --reply-to <note-address> --text <what>',
    'note --resolve <address> [--text <why>]',
    'note --reopen <address> --text <why>',
  ],
  detail: `A note is the half of a git commit Deck does not otherwise have.
A commit is (tree, parents, author, time, message); the seal log already holds
tree and parents, which leaves author, time and message homeless. This is
where they live.

It is CONTENT, not metadata: an ordinary JSON file in an ordinary deck, so it
hashes, seals, versions, forks, diffs and endorses like everything else, with
no sidecar format and no bespoke endpoint. Backported to the realm server,
each file is already a card.

Written to <depot>/<actor>/notes/. The publisher segment is the fork boundary,
so it is also the per-actor namespace — two agents writing notes at the same
moment cannot collide, by grammar rather than by merge strategy. One file per
note for the same reason.

Append-only is not a rule this enforces; it falls out of immutability. A
correction is a new note. The wrong one stays, which is what makes it
evidence rather than a draft.

THREADS AND DISMISSAL WORK THE SAME WAY. A reply is a note pointing at
another note (--reply-to); dismissing something is a note pointing at it with
kind "resolved" (--resolve), and changing your mind is "reopened" (--reopen).
Nothing is ever edited or deleted, so an agent can pick a thread up later and
read exactly what was said and in what order — which is the whole point of
letting one leave a comment for another.

The subject of a resolve is an ADDRESS, so it works on the things that
actually need dismissing: an open proposal, a conflicted merge, or another
note. The current state of a subject is simply its newest resolving note.`,
  async run(argv) {
    let { values } = parseArgs({
      args: argv,
      options: {
        depot: { type: 'string', default: '.' },
        actor: { type: 'string' },
        text: { type: 'string' },
        tree: { type: 'string' },
        at: { type: 'string' },
        kind: { type: 'string', default: 'update' },
        'reply-to': { type: 'string' },
        resolve: { type: 'string' },
        reopen: { type: 'string' },
      },
    });
    // The three relational flags each imply a kind, so a caller never has to
    // remember to set both and cannot set them inconsistently.
    let replyTo = values['reply-to'];
    let kind = values.resolve
      ? 'resolved'
      : values.reopen
        ? 'reopened'
        : replyTo
          ? 'comment'
          : values.kind;
    let subject = values.resolve ?? values.reopen ?? values.at;
    let text = values.text;
    // A dismissal may stand on its own — "handled" is a complete statement —
    // but reopening something without saying why is just noise for whoever
    // finds it next.
    if (!text && !values.resolve) {
      fail('usage: deck note --text "what you did"');
    }
    let depot = depotAt(resolve(values.depot ?? '.'));
    let actor = actorFrom(values.actor);
    if (values.tree && !/^[0-9a-f]{64}$/.test(values.tree)) {
      fail('--tree wants a 64-character sha256 tree hash');
    }

    let at = new Date();
    let stamp = at.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
    let dir = join(depot.dir, actor, 'notes');
    await mkdir(dir, { recursive: true });
    // Same actor, same second, two notes: rare, and silently overwriting one
    // would lose a record. A counter is enough and keeps names sortable.
    let existing = new Set(await readdir(dir).catch(() => []));
    let name = `${stamp}.json`;
    for (let n = 2; existing.has(name); n += 1) name = `${stamp}-${n}.json`;

    let record = {
      kind,
      actor,
      at: at.toISOString(),
      about: {
        ...(values.tree ? { tree: values.tree } : {}),
        ...(subject ? { at: depotRelative(subject, depot.name) } : {}),
        ...(replyTo ? { replyTo: depotRelative(replyTo, depot.name) } : {}),
      },
      text: text ?? '',
    };
    await writeFile(join(dir, name), `${JSON.stringify(record, null, 2)}\n`);
    // Depot-relative, so the printed address is the one to paste into
    // --reply-to and round-trips no matter what the depot is mounted as.
    console.log(`${actor}/notes/${name}`);
    if (!values.tree && !subject && !replyTo) {
      console.log(
        '   note: no --tree or --at, so this is about the depot in general',
      );
    }
  },
});

export const SAY_COMMANDS: Command[] = [claim, note];
