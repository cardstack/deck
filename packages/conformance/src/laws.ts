// The laws, as data.
//
// docs/deck-laws.md is the prose; this is the enumeration every check is
// tagged with, so a run reports which LAW failed rather than which assertion
// did. An implementation that passes every check implements Deck; that is
// the whole point of the package.

export const LAWS = {
  L1: 'identity — tree-hash-v1 over the logical tree, and nothing else',
  L2: 'round trip — packing is faithful and packs have a canonical form',
  L3: 'pointer — versions name treeHashes; naming copies no bytes',
  L4: 'immutability — a published exact version never changes',
  L5: 'volatility — live, sealed and named are three different addresses',
  L6: 'hermeticity — a sealed deck resolves everything it contains',
  L7: 'resolution — the key is the specifier; the value names the deck',
  L8: 'provenance — a copy records, checkably, what it is a copy of',
  L9: 'endorsement — a signature binds a key to a treeHash',
  L10: 'inheritance — same treeHash means same endorsements',
  L11: 'fail closed — an unverifiable claim is refused, not warned about',
  L12: 'serving — the response says what the bytes are',
} as const;

export type LawId = keyof typeof LAWS;

export interface CheckResult {
  law: LawId;
  name: string;
  ok: boolean;
  detail?: string;
  // Set when a law cannot be checked here rather than having failed —
  // an unbuilt feature, or a surface this run does not reach.
  skipped?: boolean;
}

export interface ConformanceReport {
  results: CheckResult[];
  passed: number;
  failed: number;
  skipped: number;
  // Laws with at least one check that ran and passed, and none that failed.
  lawsHeld: LawId[];
  lawsBroken: LawId[];
  lawsUnchecked: LawId[];
}

export function summarize(results: CheckResult[]): ConformanceReport {
  let byLaw = new Map<LawId, { ran: boolean; failed: boolean }>();
  for (let result of results) {
    let state = byLaw.get(result.law) ?? { ran: false, failed: false };
    if (!result.skipped) {
      state.ran = true;
      state.failed ||= !result.ok;
    }
    byLaw.set(result.law, state);
  }
  let ids = Object.keys(LAWS) as LawId[];
  return {
    results,
    passed: results.filter((r) => r.ok && !r.skipped).length,
    failed: results.filter((r) => !r.ok && !r.skipped).length,
    skipped: results.filter((r) => r.skipped).length,
    lawsHeld: ids.filter((id) => byLaw.get(id)?.ran && !byLaw.get(id)?.failed),
    lawsBroken: ids.filter((id) => byLaw.get(id)?.failed),
    lawsUnchecked: ids.filter((id) => !byLaw.get(id)?.ran),
  };
}

// A tiny harness so a check reads as one line and a thrown error is a
// failure rather than a crash.
export class Checks {
  results: CheckResult[] = [];

  async run(
    law: LawId,
    name: string,
    body: () => void | Promise<void>,
  ): Promise<void> {
    try {
      await body();
      this.results.push({ law, name, ok: true });
    } catch (error) {
      this.results.push({
        law,
        name,
        ok: false,
        detail: error instanceof Error ? error.message : String(error),
      });
    }
  }

  skip(law: LawId, name: string, detail: string): void {
    this.results.push({ law, name, ok: true, skipped: true, detail });
  }
}

export function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

export function assertEqual<T>(actual: T, expected: T, what: string): void {
  if (actual !== expected) {
    throw new Error(`${what}: expected ${String(expected)}, got ${String(actual)}`);
  }
}

export function formatReport(report: ConformanceReport): string {
  let lines: string[] = [];
  for (let result of report.results) {
    let mark = result.skipped ? '  --' : result.ok ? '  ok' : 'FAIL';
    lines.push(
      `${mark}  ${result.law.padEnd(3)} ${result.name}${result.detail && !result.ok ? `\n        ${result.detail}` : ''}${result.skipped && result.detail ? `  (${result.detail})` : ''}`,
    );
  }
  lines.push('');
  lines.push(
    `${report.passed} passed, ${report.failed} failed, ${report.skipped} not applicable`,
  );
  if (report.lawsBroken.length > 0) {
    lines.push(`BROKEN: ${report.lawsBroken.join(', ')}`);
    for (let law of report.lawsBroken) {
      lines.push(`  ${law} ${LAWS[law]}`);
    }
  }
  if (report.lawsUnchecked.length > 0) {
    lines.push(`not checked here: ${report.lawsUnchecked.join(', ')}`);
  }
  return lines.join('\n');
}
