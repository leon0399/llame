import { isString } from '@workspace/runtime-safety';

import {
  type InRunAttempt,
  type InRunAttemptProducer,
  type InRunContextProducer,
  type InRunToolCall,
} from '../runs/in-run-context-items';
import { enterWorkspaceTool } from '../tools/workspace';
import { createGitItem } from './git-item';

/** The `git` producer's providers' token. */
export const GIT_CONTEXT_PRODUCER = Symbol('GIT_CONTEXT_PRODUCER');

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

      // The step began after the entry settled: a root other than the entry's
      // means the entry's binding is not the one this step holds.
      if (world.currentRoot() !== entry.root) return;

      const item = createGitItem({
        runId: attempt.runId,
        observation: await world.observe(entry.root),
      });

      if (!entry.newBinding && item.data.text === told) return;
      told = item.data.text;
      step.stage(item);
    },
  };
}

/**
 * The `git` producer (openspec `workspace-git-state`): an in-Run item after an
 * entry that bound or switched the root, or re-entered it with a changed state.
 * The turn's own item is staged by `refreshTurnGit`. It holds no state beyond
 * one attempt and adds no column.
 */
export function createGitProducer(): InRunContextProducer {
  return { beginAttempt: createAttemptProducer };
}
