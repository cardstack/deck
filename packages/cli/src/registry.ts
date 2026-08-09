// Every command, in one list.
//
// The dispatcher looks a name up here and the help screens are rendered
// from the same records, so a command cannot exist without documenting
// itself and cannot be documented without existing.

import { GROUPS, type Command, type GroupId } from './command.ts';
import { START_COMMANDS } from './commands/start.ts';
import { SEAL_COMMANDS } from './commands/seal.ts';
import { PUBLISH_COMMANDS } from './commands/publish.ts';
import { DEPEND_COMMANDS } from './commands/depend.ts';
import { PROPOSE_COMMANDS } from './commands/propose.ts';
import { ENDORSE_COMMANDS } from './commands/endorse.ts';
import { RECALL_COMMANDS } from './commands/recall.ts';
import { PROVE_COMMANDS } from './commands/prove.ts';

export const COMMANDS: Command[] = [
  ...START_COMMANDS,
  ...SEAL_COMMANDS,
  ...PUBLISH_COMMANDS,
  ...DEPEND_COMMANDS,
  ...PROPOSE_COMMANDS,
  ...ENDORSE_COMMANDS,
  ...RECALL_COMMANDS,
  ...PROVE_COMMANDS,
];

const BY_NAME = new Map(COMMANDS.map((command) => [command.name, command]));

export function findCommand(name: string): Command | undefined {
  return BY_NAME.get(name);
}

export function commandsIn(group: GroupId): Command[] {
  return COMMANDS.filter((command) => command.group === group);
}

// A group with no commands, or a command in no group, means the two lists
// disagreed — a mistake that would otherwise show up as a silently missing
// help section rather than as an error.
export function assertGroupsCovered(): void {
  let ids = new Set(GROUPS.map((group) => group.id));
  for (let command of COMMANDS) {
    if (!ids.has(command.group)) {
      throw new Error(`command "${command.name}" is in unknown group "${command.group}"`);
    }
  }
  for (let group of GROUPS) {
    if (commandsIn(group.id).length === 0) {
      throw new Error(`group "${group.id}" has no commands`);
    }
  }
}
