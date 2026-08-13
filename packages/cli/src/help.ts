// Help, rendered from the command records rather than kept beside them.

import { GROUPS, type Command } from './command.ts';
import { COMMANDS, commandsIn, findCommand } from './registry.ts';

const BANNER = `deck — the Deck protocol CLI

A depot is a directory; its layout IS its URL space:

  <root>/<depot>/<publisher>/<package>/app.js   on disk
  /<depot>/<publisher>/<package>/app.js         live, every save visible
  /<depot>/<publisher>/<package>@1.2.0/app.js   the sealed copy
  /<depot>/_history/<changeId>/<path>           any state, published or not

Sealed versions live in <depot>/.deck/store/, Timeline in
<depot>/.deck/timeline/ (via deckd) — both inside the depot, both invisible
to the tree hash, so a depot directory is self-contained and movable.`;

const FOOTER = `\`deck help <command>\` explains one command in full;
\`deck help --all\` prints every explanation at once.

On a running server, open /deckbook.html for the teaching tour (Deckbook).`;

const NAME_COLUMN = Math.max(...COMMANDS.map((command) => command.name.length)) + 2;

// Only the first usage line gets the verb. A continuation line already
// carries the indentation that aligns it under the command name, so it is
// padded by exactly the width `deck ` occupies and no more.
function usageBlock(command: Command): string {
  return command.usage
    .map((line, index) => (index === 0 ? `  deck ${line}` : `       ${line}`))
    .join('\n');
}

// Detail text is authored as prose in a template literal, where the first
// line is always short because it starts after the opening backtick. So the
// help re-wraps rather than trusting the source's line breaks — a command
// author should be thinking about the explanation, not the column count.
function reflow(text: string, width = 74, indent = '  '): string {
  return text
    .split(/\n\s*\n/)
    .map((paragraph) => {
      let lines: string[] = [];
      let current = indent;
      for (let word of paragraph.split(/\s+/).filter(Boolean)) {
        if (current !== indent && current.length + 1 + word.length > width) {
          lines.push(current);
          current = indent;
        }
        current += current === indent ? word : ` ${word}`;
      }
      lines.push(current);
      return lines.join('\n');
    })
    .join('\n\n');
}

/** The default screen: what the CLI does, in eight groups. */
export function overview(): string {
  let sections = GROUPS.map((group) => {
    let lines = commandsIn(group.id).map(
      (command) =>
        `  ${command.name.padEnd(NAME_COLUMN)}${command.summary}`,
    );
    return `${group.title} — ${group.blurb}\n${lines.join('\n')}`;
  });
  return `${BANNER}\n\n${sections.join('\n\n')}\n\n${FOOTER}\n`;
}

/** One command, in full. */
export function commandHelp(command: Command): string {
  let parts = [
    `deck ${command.name} — ${command.summary}`,
    '',
    usageBlock(command),
  ];
  if (command.detail) {
    parts.push('', reflow(command.detail));
  }
  return `${parts.join('\n')}\n`;
}

/** Everything, for reading straight through or piping to a pager. */
export function fullHelp(): string {
  let sections = GROUPS.map((group) => {
    let commands = commandsIn(group.id)
      .map((command) => commandHelp(command))
      .join('\n');
    return `${'═'.repeat(72)}\n${group.title} — ${group.blurb}\n${'═'.repeat(72)}\n\n${commands}`;
  });
  return `${BANNER}\n\n${sections.join('')}${FOOTER}\n`;
}

/** `deck help`, `deck help --all`, `deck help <name>`. */
export function help(argv: string[]): string {
  let [topic] = argv;
  if (!topic) {
    return overview();
  }
  if (topic === '--all' || topic === 'all') {
    return fullHelp();
  }
  let command = findCommand(topic);
  if (command) {
    return commandHelp(command);
  }
  return `deck: no command "${topic}"${suggestion(topic)}\n\n${overview()}`;
}

// Not a spell-checker — just the two cheap cases that account for most
// misses: a prefix of a real name, and a real name this is a prefix of.
export function suggestion(name: string): string {
  let near = COMMANDS.map((command) => command.name).filter(
    (candidate) => candidate.startsWith(name) || name.startsWith(candidate),
  );
  return near.length > 0 ? ` — did you mean ${near.join(' or ')}?` : '';
}
