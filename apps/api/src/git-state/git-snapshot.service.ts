import { Inject, Injectable } from '@nestjs/common';
import { type GitFailure } from '@workspace/machine-protocol';

import { ExecutorGitError } from '../machines/executor-git-error';
import {
  ExecutorGit,
  type ExecutorTarget,
} from '../machines/executor-git.service';
import { normalizeGitState } from './git-state-normalize';
import { type GitAbsenceReason, type GitObservation } from './git-state-view';

/** One wall-clock deadline over the whole observation. */
export const GIT_OBSERVATION_DEADLINE_MS = 5000;

/** The executor's own limit for the `git.state` call. */
const STATE_TIMEOUT_MS = 3000;
const PATH_LIMIT = 20;

export type GitObserveInput = {
  readonly target: ExecutorTarget;
  /** The canonical Workspace root address: a path or a Machine locator. */
  readonly root: string;
  /** The model path checks `read` admission; the owner route admits. */
  readonly admit: (gitEntry: string) => boolean;
  /** Machine only: `false` answers `machine_unavailable` before any request. */
  readonly reachable?: () => Promise<boolean>;
  readonly signal?: AbortSignal;
};

const unavailable = (reason: GitAbsenceReason): GitObservation => ({
  kind: 'unavailable',
  reason,
});

function failureObservation(failure: GitFailure): GitObservation {
  switch (failure.type) {
    case 'timed_out':
      return unavailable('timeout');
    case 'output_bound':
      return unavailable('too_many_changes');
    case 'root_missing':
      return unavailable('root_not_found');
    case 'no_repository_in_root':
      return unavailable('no_repository_in_root');
    case 'outside_registered_root':
      return unavailable('outside_registered_root');
    default:
      return unavailable('git_failed');
  }
}

function thrownObservation(error: unknown): GitObservation {
  if (error instanceof ExecutorGitError) {
    if (error.code === 'machine_unavailable')
      return unavailable('machine_unavailable');

    if (error.code === 'machine_update_required')
      return unavailable('machine_update_required');
  }

  return unavailable('git_failed');
}

/**
 * The git state of the repository that holds a Workspace root (design D6):
 * locate, admit, then one bounded `git.state`, all under one deadline. It never
 * throws: every failure is a closed absence reason and never carries stderr.
 */
@Injectable()
export class GitSnapshotService {
  constructor(
    @Inject(ExecutorGit)
    private readonly executors: Pick<ExecutorGit, 'locateEntry' | 'state'>,
  ) {}

  async observe(input: GitObserveInput): Promise<GitObservation> {
    const deadline = new AbortController();

    const signal =
      input.signal === undefined
        ? deadline.signal
        : AbortSignal.any([deadline.signal, input.signal]);

    const { promise: expiry, resolve } =
      Promise.withResolvers<GitObservation>();

    const timer = setTimeout(() => {
      deadline.abort();
      resolve(unavailable('timeout'));
    }, GIT_OBSERVATION_DEADLINE_MS);

    try {
      return await Promise.race([this.read(input, signal), expiry]);
    } finally {
      clearTimeout(timer);
    }
  }

  private async read(
    input: GitObserveInput,
    signal: AbortSignal,
  ): Promise<GitObservation> {
    try {
      if (
        input.target.machine !== undefined &&
        input.reachable !== undefined &&
        !(await input.reachable())
      )
        return unavailable('machine_unavailable');

      const located = await this.executors.locateEntry(
        input.target,
        input.root,
        { signal },
      );

      if (located.status === 'error')
        return located.type === 'not_a_repository'
          ? { kind: 'not_a_repository' }
          : failureObservation(located);

      if (!input.admit(located.gitEntry)) return unavailable('not_permitted');

      const state = await this.executors.state(
        input.target,
        input.root,
        {
          gitEntry: located.gitEntry,
          limit: PATH_LIMIT,
          submodules: 'skip',
          timeoutMs: STATE_TIMEOUT_MS,
        },
        { signal },
      );

      return state.status === 'error'
        ? failureObservation(state)
        : { kind: 'state', view: normalizeGitState(state) };
    } catch (error) {
      return thrownObservation(error);
    }
  }
}
