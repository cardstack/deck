// A deterministic conflict resolver.
//
// The generic three-way merge in @cardstack/deck is deliberately conservative:
// when both sides changed the same key differently, it refuses. It has to,
// because it does not know what the key MEANS. `scale` is a set — two people
// extending it are agreeing. `radius` is a scalar — two people setting it are
// disagreeing, but there may still be a house rule for which answer wins.
// Nothing generic can tell those apart.
//
// So the rules live in the DATA, published by upstream, versioned like
// everything else: `merge-policy.json` in the upstream deck. This script
// reads them and resolves what they cover.
//
// Three properties make it a resolver rather than a coin flip:
//
//   Deterministic — every rule is a pure function of (base, upstream, fork).
//     Same three inputs, same output, on any machine, in any order. `union`
//     sorts, so it does not matter which side is called ours.
//   Auditable — the rule that decided each key is reported, and it came from
//     a file in a sealed tree that anyone can read.
//   Fail-closed — a key with no rule is NOT guessed. The whole resolution is
//     abandoned and nothing is written, exactly as the daemon does (L11). A
//     resolver that quietly picks a side is worse than no resolver, because
//     you stop reading its output.

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { IMPORT_MAP_PATH } from '@cardstack/deck/import-map';
import { mergeTrees } from '@cardstack/deck/merge';
import { unpack } from '@cardstack/deck/pack';
import { writeForkedFrom } from '@cardstack/deck/offer';
import { readStoredPack, readStoreMeta } from '@cardstack/deck/store';
import { readTreeFromDir, writeTreeToDir } from '@cardstack/deck/tree';

export const POLICY_PATH = 'merge-policy.json';

// Every rule is commutative in (upstream, fork) or explicitly names a side.
// Anything that depended on argument order would not be a resolution — it
// would be a race that happens to be reproducible on one machine.
export const RULES = {
  // A set that both sides extended. Sorted, so order in, order out.
  union(_base, upstream, fork) {
    if (!Array.isArray(upstream) || !Array.isArray(fork)) {
      return undefined;
    }
    let seen = new Map();
    for (let item of [...upstream, ...fork]) {
      seen.set(JSON.stringify(item), item);
    }
    return [...seen.values()].sort((a, b) =>
      typeof a === 'number' && typeof b === 'number'
        ? a - b
        : String(a) < String(b)
          ? -1
          : 1,
    );
  },
  max: (_base, upstream, fork) =>
    typeof upstream === 'number' && typeof fork === 'number'
      ? Math.max(upstream, fork)
      : undefined,
  min: (_base, upstream, fork) =>
    typeof upstream === 'number' && typeof fork === 'number'
      ? Math.min(upstream, fork)
      : undefined,
  upstream: (_base, upstream) => upstream,
  fork: (_base, _upstream, fork) => fork,
};

const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
const isObject = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * The same three-way walk the core merge does, with one difference: where it
 * would report a conflict, this consults the rules. Returns the merged value
 * plus a decision per resolved key and a list of keys nothing covered.
 */
export function mergeWithPolicy(base, upstream, fork, rules, path = '') {
  let decisions = [];
  let unresolved = [];
  let at = (key) => (path ? `${path}.${key}` : key);

  if (same(upstream, fork)) return { value: fork, decisions, unresolved };
  if (same(base, upstream)) return { value: fork, decisions, unresolved };
  if (same(base, fork)) return { value: upstream, decisions, unresolved };

  if (isObject(upstream) && isObject(fork)) {
    let baseObject = isObject(base) ? base : {};
    let value = {};
    for (let key of new Set([...Object.keys(upstream), ...Object.keys(fork)])) {
      let inUpstream = key in upstream;
      let inFork = key in fork;
      if (inUpstream && inFork) {
        let child = mergeWithPolicy(
          key in baseObject ? baseObject[key] : undefined,
          upstream[key],
          fork[key],
          rules,
          at(key),
        );
        value[key] = child.value;
        decisions.push(...child.decisions);
        unresolved.push(...child.unresolved);
        continue;
      }
      // One side only: an add if the base never had it, else a delete.
      let present = inUpstream ? upstream[key] : fork[key];
      if (!(key in baseObject)) {
        value[key] = present;
        continue;
      }
      if (same(baseObject[key], present)) {
        continue;
      }
      value[key] = present;
      unresolved.push({ key: at(key), reason: 'deleted on one side, changed on the other' });
    }
    return { value, decisions, unresolved };
  }

  // A leaf both sides changed differently. This is the one place a rule can
  // speak, and the one place this script is allowed to decide anything.
  let name = rules[path];
  let rule = name ? RULES[name] : undefined;
  if (!rule) {
    return {
      value: fork,
      decisions,
      unresolved: [
        { key: path, reason: name ? `unknown rule "${name}"` : 'no rule declared' },
      ],
    };
  }
  let resolved = rule(base, upstream, fork);
  if (resolved === undefined) {
    return {
      value: fork,
      decisions,
      unresolved: [{ key: path, reason: `rule "${name}" does not apply to these types` }],
    };
  }
  return {
    value: resolved,
    decisions: [{ key: path, rule: name, base, upstream, fork, resolved }],
    unresolved,
  };
}

async function treeAt(storeDir, deck, version) {
  let bytes = await readStoredPack(storeDir, deck, version);
  return bytes ? unpack(bytes).files : undefined;
}

const parse = (bytes) => (bytes ? JSON.parse(bytes.toString('utf8')) : undefined);
const serialize = (value) =>
  Buffer.from(JSON.stringify(value, null, 2) + '\n', 'utf8');

/**
 * Resolve one conflicted plan by policy, and — only if EVERY conflict is
 * covered — write the merged tree into the fork and advance its base pointer,
 * which is what `applyRebase` does for a clean merge. The fork's next save is
 * the merged state, published and sealed like any other.
 */
export async function resolveByPolicy({ storeDir, plan, dryRun = false }) {
  let { offer, upstreamVersion, upstreamTreeHash } = plan;
  let upstreamDeck = offer.forkedFrom.package;
  let meta = await readStoreMeta(storeDir, upstreamDeck);
  let baseVersion = Object.entries(meta?.versions ?? {}).find(
    ([, record]) => record.treeHash === offer.forkedFrom.treeHash,
  )?.[0];
  if (!baseVersion) {
    return { state: 'unresolvable', detail: 'the base tree is not in the store' };
  }
  let baseTree = await treeAt(storeDir, upstreamDeck, baseVersion);
  let upstreamTree = await treeAt(storeDir, upstreamDeck, upstreamVersion);
  let forkTree = await readTreeFromDir(offer.dir);
  if (!baseTree || !upstreamTree) {
    return { state: 'unresolvable', detail: 'a pack is missing' };
  }

  // Upstream owns the rules, so they are read from the version being merged
  // IN — not from the fork, which would let a proposal grant itself the
  // right to win.
  let rules = parse(upstreamTree.get(POLICY_PATH))?.rules ?? {};

  let { files, conflicts } = mergeTrees(baseTree, upstreamTree, forkTree);
  let decisions = [];
  let unresolved = [];
  for (let path of conflicts) {
    if (!path.endsWith('.json')) {
      unresolved.push({ file: path, key: '(whole file)', reason: 'not JSON' });
      continue;
    }
    let merged = mergeWithPolicy(
      parse(baseTree.get(path)),
      parse(upstreamTree.get(path)),
      parse(forkTree.get(path)),
      rules,
    );
    if (merged.unresolved.length > 0) {
      unresolved.push(...merged.unresolved.map((u) => ({ file: path, ...u })));
      continue;
    }
    files.set(path, serialize(merged.value));
    decisions.push(...merged.decisions.map((d) => ({ file: path, ...d })));
  }

  // Fail closed. One key nothing covers means the whole resolution is a
  // proposal for a person, not an outcome — so nothing is written.
  if (unresolved.length > 0) {
    return { state: 'undecidable', decisions, unresolved };
  }
  if (dryRun) {
    return { state: 'resolved', decisions, unresolved, written: [] };
  }

  files.set(
    IMPORT_MAP_PATH,
    Buffer.from(
      writeForkedFrom(
        files.get(IMPORT_MAP_PATH)?.toString('utf8') ??
          (await readFile(join(offer.dir, IMPORT_MAP_PATH), 'utf8')),
        offer.package,
        { ...offer.forkedFrom, version: upstreamVersion, treeHash: upstreamTreeHash },
      ),
      'utf8',
    ),
  );
  let { written, deleted } = await writeTreeToDir(offer.dir, files);
  return { state: 'resolved', decisions, unresolved, written, deleted };
}
