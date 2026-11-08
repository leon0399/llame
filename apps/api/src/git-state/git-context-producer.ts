import { isString } from '@workspace/runtime-safety';

import { type AuthoredContextItemPart } from '../chats/context-item';
import {
  type InRunAttempt,
  type InRunAttemptProducer,
  type InRunContextProducer,
  type InRunToolCall,
  type InRunTurnContext,
} from '../runs/in-run-context-items';
import { enterWorkspaceTool } from '../tools/workspace';
import { createGitItem } from './git-item';
import { type GitObservation } from './git-state-view';

/** The `git` producer's providers' token. */
export const GIT_CONTEXT_PRODUCER = Symbol('GIT_CONTEXT_PRODUCER');

const GIT_FAILED: GitObservation = {
  kind: 'unavailable',
  reason: 'git_failed',
};

/** A settled entry the next step tells: its root, and whether it is a new binding. */
type SettledEntry = { readonly root: string; readonly newBinding: boolean };

function settledEntry(call: InRunToolCall): SettledEntry | undefined {
  if (call.toolName !== enterWorkspaceTool.id) return undefined;
  const result = call.result;
  if (result === undefined || result.status !== 'success') return undefined;
  const state = result['state'];
  const root = result['root'];
  if (!isString(root)) return undefined;
  if (state === 'bound' || state === 'switched') {
    return { root, newBinding: true };
  }
  return state === 'unchanged' ? { root, newBinding: false } : undefined;
}

/**
 * The per-attempt state of the `git` producer: the last text this attempt told,
 * and the entry the next step observes. An `exit_workspace` stages nothing.
 */
function createAttemptProducer(attempt: InRunAttempt): InRunAttemptProducer {
  const world = attempt.git;
  let told = world?.toldText;
  let pending: SettledEntry | undefined;
  return {
    observeToolCall(call): void {
      if (world === undefined) return;
      const entry = settledEntry(call);
      if (entry === undefined) return;
      // Several entries in one step: the last root wins, and one that bound
      // or switched keeps the step telling the state.
      pending = {
        root: entry.root,
        newBinding: entry.newBinding || pending?.newBinding === true,
      };
    },
    async prepareStep(step): Promise<void> {
      const entry = pending;
      pending = undefined;
      if (world === undefined || entry === undefined) return;
      let observation: GitObservation;
      try {
        observation = await world.observe(entry.root);
      } catch {
        observation = GIT_FAILED;
      }
      const item = createGitItem({ runId: attempt.runId, observation });
      if (!entry.newBinding && item.data.text === told) return;
      told = item.data.text;
      step.stage(item);
    },
  };
}

/**
 * The `git` producer (openspec `workspace-git-state`): the turn's item when the
 * observed text differs from what the effective history told, and an in-Run
 * item after an entry that bound or switched the root, or re-entered it with a
 * changed state. It holds no state beyond one attempt and adds no column.
 */
export function createGitProducer(): InRunContextProducer {
  return {
    beginAttempt: createAttemptProducer,
    prepareTurn(
      context: InRunTurnContext,
    ): Promise<AuthoredContextItemPart | undefined> {
      const { git } = context;
      if (git === undefined) return Promise.resolve(undefined);
      const item = createGitItem({
        runId: context.runId,
        observation: git.observation,
      });
      return Promise.resolve(
        item.data.text === git.toldText ? undefined : item,
      );
    },
  };
}
