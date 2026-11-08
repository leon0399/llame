import { isRecord } from '@workspace/runtime-safety';

import {
  isContextItemPart,
  type AuthoredContextItemPart,
} from '../chats/context-item';
import { createRenderedContextItem } from '../chats/context-item-shared';
import { enterWorkspaceTool, exitWorkspaceTool } from '../tools/workspace';
import { renderGitObservation } from './git-state-render';
import { type GitObservation } from './git-state-view';

/**
 * The `git` item of one observation. The payload is the observation itself:
 * the normalized view, or the closed absence kind and reason, never a raw
 * remote URL or an error text.
 */
export function createGitItem(input: {
  readonly runId: string;
  readonly observation: GitObservation;
}): AuthoredContextItemPart {
  return createRenderedContextItem({
    producer: 'git',
    form: 'snapshot',
    runId: input.runId,
    payload: { ...input.observation },
    body: renderGitObservation(input.observation),
  });
}

/**
 * Whether a stored tool part is a successful entry that bound or switched the
 * root, or a successful exit. A same-root re-entry restarts nothing.
 */
// eslint-disable-next-line anti-slop/no-unknown-parameters -- the argument is one stored jsonb part; `isRecord` parses it before anything inside it is read.
function changesBinding(part: unknown): boolean {
  if (!isRecord(part) || part['state'] !== 'output-available') return false;
  if (part['type'] === `tool-${exitWorkspaceTool.id}`) return true;
  if (part['type'] !== `tool-${enterWorkspaceTool.id}`) return false;
  const output = part['output'];
  return (
    isRecord(output) &&
    (output['state'] === 'bound' || output['state'] === 'switched')
  );
}

/**
 * The full text of the `git` item the effective history last told, or
 * undefined when none holds. `parts` are the stored parts of the active
 * compaction epoch in message order. A binding change after the item — a
 * `workspace` item, a binding entry, or an exit — voids it, so the state is
 * told again. The envelope is deterministic (producer, form, body), so full
 * text equality is body equality.
 */
export function gitToldText(parts: Iterable<unknown>): string | undefined {
  let told: string | undefined;
  for (const part of parts) {
    if (isContextItemPart(part)) {
      if (part.data.producer === 'workspace') told = undefined;
      else if (part.data.producer === 'git') told = part.data.text;
    } else if (changesBinding(part)) {
      told = undefined;
    }
  }
  return told;
}
