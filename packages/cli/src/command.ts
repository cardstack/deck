// What a command IS, and what the eight things this CLI does are.
//
// The old help was a 150-line string maintained by hand beside 1,800 lines
// of switch. Two copies of the same knowledge drift, and the string is the
// copy that drifts silently — nothing fails when it goes stale. So a command
// now carries its own usage and explanation, and every help screen is
// rendered from the same records the dispatcher looks up.

export type GroupId =
  | 'start'
  | 'seal'
  | 'publish'
  | 'depend'
  | 'repository'
  | 'propose'
  | 'endorse'
  | 'recall'
  | 'prove'
  | 'say';

export interface Group {
  id: GroupId;
  title: string;
  blurb: string;
}

// Ordered the way the work happens, not alphabetically: you stand a depot
// up, you seal trees, you name them, you wire in what they depend on, you
// propose changes to someone else's, you endorse bytes, you go back, and you
// prove the whole thing against the contract.
export const GROUPS: Group[] = [
  {
    id: 'start',
    title: 'start',
    blurb: 'stand a depot up and serve it live',
  },
  {
    id: 'seal',
    title: 'seal',
    blurb: 'a directory in, a verified pack out — identity, offline',
  },
  {
    id: 'publish',
    title: 'publish',
    blurb: "name sealed states in a depot's store",
  },
  {
    id: 'depend',
    title: 'depend',
    blurb: 'what a deck uses, and which bytes answer to it',
  },
  {
    id: 'repository',
    title: 'repository',
    blurb: 'branch, commit, review, and merge related packages atomically',
  },
  {
    id: 'propose',
    title: 'propose',
    blurb: "change someone else's deck without a branch",
  },
  {
    id: 'endorse',
    title: 'endorse',
    blurb: 'who stands behind these bytes',
  },
  {
    id: 'recall',
    title: 'recall',
    blurb: 'every state the depot has been in',
  },
  {
    id: 'prove',
    title: 'prove',
    blurb: 'the executable contract',
  },
  {
    id: 'say',
    title: 'say',
    blurb: 'what you are working on, and what you did',
  },
];

export interface Command {
  name: string;
  group: GroupId;
  /** One line. This is what the overview screen shows. */
  summary: string;
  /** Usage line(s), without the leading `deck`. */
  usage: string[];
  /** The longer explanation, shown by `deck help <name>`. */
  detail?: string;
  run(argv: string[]): Promise<void>;
}

export function defineCommand(command: Command): Command {
  return command;
}
