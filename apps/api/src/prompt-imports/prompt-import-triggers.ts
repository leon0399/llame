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

import {
  parsePathScheme,
  splitSelectorSuffix,
  statHostPath,
} from '@workspace/native-file-tools';

import type { PromptImportsPayloadEntry } from '../chats/prompt-imports-item';
import { isKnowledgeSpaceId } from '../knowledge/knowledge-filesystem-validation';
import {
  KNOWLEDGE_LOCATOR_SCHEME,
  parseKnowledgeLocator,
} from '../knowledge/knowledge-locator';
import type { PromptImportTrigger } from '../runs/in-run-context-items';

/** Which worlds the Run may load instruction files in. */
export type PromptImportTriggerGates = {
  readonly host: boolean;
  readonly knowledge: boolean;
};

/**
 * Host paths probe the whole literal first, as `read` does, then the path with
 * its selector split off. `resolved` keeps the selector of an import whose
 * literal path did not exist, so the literal probe decides which spelling names
 * the file.
 */
async function hostTrigger(
  resolved: string,
): Promise<PromptImportTrigger | undefined> {
  if (!resolved.startsWith('/')) return undefined;
  const literal = await statHostPath(resolved);
  const path =
    literal.kind === 'missing' ? splitSelectorSuffix(resolved).path : resolved;
  return { key: posix.resolve(path) };
}

/**
 * A `kb://` trigger names its Space and a Space-relative key, selector dropped.
 * Only the canonical lower-case Space id forms one, the form llame itself
 * writes, so one Space is one group in the producer.
 */
function knowledgeTrigger(rest: string): PromptImportTrigger | undefined {
  const parsed = parseKnowledgeLocator(rest);
  if ('type' in parsed) return undefined;
  const id = parsed.knowledgeSpaceId;
  if (!isKnowledgeSpaceId(id) || id !== id.toLowerCase()) return undefined;
  return { space: { id }, key: parsed.relativePath ?? '' };
}

async function triggerOf(
  entry: PromptImportsPayloadEntry,
  gates: PromptImportTriggerGates,
): Promise<PromptImportTrigger | undefined> {
  const resolved = entry.resolved;
  if (resolved === undefined || entry.outcome === 'denied') return undefined;
  const scheme = parsePathScheme(resolved);
  if (scheme === undefined) {
    return gates.host ? hostTrigger(resolved) : undefined;
  }
  return scheme.scheme === KNOWLEDGE_LOCATOR_SCHEME && gates.knowledge
    ? knowledgeTrigger(scheme.rest)
    : undefined;
}

/**
 * The distinct triggers of a persisted item's entries in entry order. A host
 * trigger needs the host gate and a Knowledge trigger the Knowledge gate; no
 * Workspace binding is involved, because every `resolved` path is absolute or
 * canonical and is never projected again.
 */
export async function derivePromptImportTriggers(
  entries: ReadonlyArray<PromptImportsPayloadEntry>,
  gates: PromptImportTriggerGates,
): Promise<Array<PromptImportTrigger>> {
  const triggers: Array<PromptImportTrigger> = [];
  const seen = new Set<string>();
  for (const entry of entries) {
    const trigger = await triggerOf(entry, gates);
    if (trigger === undefined) continue;
    const identity = `${trigger.space?.id ?? ''}\0${trigger.key}`;
    if (seen.has(identity)) continue;
    seen.add(identity);
    triggers.push(trigger);
  }
  return triggers;
}
