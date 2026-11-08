import { isRecord, isString } from '@workspace/runtime-safety';

import {
  isContextItemPart,
  type AuthoredContextItemPart,
} from '../chats/context-item';
import { createRenderedContextItem } from '../chats/context-item-shared';
import {
  isWorkspaceDetachPayload,
  isWorkspaceSnapshotPayload,
} from '../chats/context-item-producers';
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
 * What the effective history told about git: the text of the last `git` item,
 * and the Workspace root the history leaves bound (`null` once detached,
 * `undefined` when it names none).
 */
export type GitToldState = {
  readonly text: string | undefined;
  readonly root: string | null | undefined;
};

export const NOTHING_TOLD: GitToldState = { text: undefined, root: undefined };

// eslint-disable-next-line anti-slop/no-unknown-parameters -- the argument is one stored jsonb part; `isRecord` parses it before anything inside it is read.
function toolBinding(part: unknown): GitToldState | undefined {
  if (!isRecord(part) || part['state'] !== 'output-available') return undefined;
  if (part['type'] === `tool-${exitWorkspaceTool.id}`) {
    return { text: undefined, root: null };
  }
  if (part['type'] !== `tool-${enterWorkspaceTool.id}`) return undefined;
  const output = part['output'];
  if (
    !isRecord(output) ||
    (output['state'] !== 'bound' && output['state'] !== 'switched')
  ) {
    return undefined;
  }
  const root = output['root'];
  return { text: undefined, root: isString(root) ? root : undefined };
}

/**
 * The told state after one more stored part. A binding change voids the told
 * text: a detach notice, a successful exit, an entry that bound or switched
 * the root, and a `workspace` snapshot naming another root than the one bound.
 * A same-root snapshot restarts nothing: it re-tells the binding the history
 * already holds, as a fork or a mid-Run entry leaves it to do.
 */
export function advanceGitTold(
  state: GitToldState,
  part: unknown,
): GitToldState {
  if (!isContextItemPart(part)) return toolBinding(part) ?? state;
  const { producer, payload } = part.data;
  if (producer === 'git') return { ...state, text: part.data.text };
  if (producer !== 'workspace') return state;
  if (isWorkspaceDetachPayload(payload)) return { text: undefined, root: null };
  if (!isWorkspaceSnapshotPayload(payload)) return state;
  return payload.root === state.root
    ? state
    : { text: undefined, root: payload.root };
}

/**
 * The told state of `parts`, the stored parts of the active compaction epoch in
 * message order. The envelope is deterministic (producer, form, body), so full
 * text equality is body equality.
 */
export function gitToldState(parts: Iterable<unknown>): GitToldState {
  let state = NOTHING_TOLD;
  for (const part of parts) state = advanceGitTold(state, part);
  return state;
}
