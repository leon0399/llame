/**
 * The accepted-turn instruction triggers a persisted prompt-imports item marks
 * (prompt-imports: Admitted local imports trigger instruction loading).
 *
 * Only the persisted item decides: every entry with a `resolved` path whose
 * outcome is `imported` or `failed` was admitted, so it behaves like a native
 * `read` of that path whatever the read itself returned. A denied entry has no
 * `resolved` path, and a web or `skill://` target never had one.
 */

import { posix } from 'node:path';

import { parsePathScheme } from '@workspace/native-file-tools';

import type { PromptImportsPayloadEntry } from '../chats/prompt-imports-item';
import { spaceTarget } from '../instructions/instructions-producer';
import { KNOWLEDGE_LOCATOR_SCHEME } from '../knowledge/knowledge-locator';
import type { PromptImportTrigger } from '../runs/in-run-context-items';

/** Which worlds the Run may load instruction files in. */
export type PromptImportTriggerGates = {
  readonly host: boolean;
  readonly knowledge: boolean;
};

/**
 * The stored `resolved` path never carries a selector — the item persists the
 * literal path or the selector-free one — so a `:`-suffixed name is a literal
 * file name and only needs normalizing.
 */
function triggerOf(
  entry: PromptImportsPayloadEntry,
  gates: PromptImportTriggerGates,
): PromptImportTrigger | undefined {
  const resolved = entry.resolved;
  if (resolved === undefined || entry.outcome === 'denied') return undefined;
  const scheme = parsePathScheme(resolved);
  if (scheme === undefined) {
    return gates.host && resolved.startsWith('/')
      ? { key: posix.resolve(resolved) }
      : undefined;
  }
  return scheme.scheme === KNOWLEDGE_LOCATOR_SCHEME && gates.knowledge
    ? spaceTarget(scheme.rest)
    : undefined;
}

/**
 * The triggers of a persisted item's entries in entry order. A host trigger
 * needs the host gate and a Knowledge trigger the Knowledge gate; no Workspace
 * binding is involved, because every `resolved` path is absolute or canonical
 * and is never projected again.
 */
export function derivePromptImportTriggers(
  entries: ReadonlyArray<PromptImportsPayloadEntry>,
  gates: PromptImportTriggerGates,
): Array<PromptImportTrigger> {
  const triggers: Array<PromptImportTrigger> = [];
  for (const entry of entries) {
    const trigger = triggerOf(entry, gates);
    if (trigger !== undefined) triggers.push(trigger);
  }
  return triggers;
}
