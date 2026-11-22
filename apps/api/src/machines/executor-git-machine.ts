/**
 * The Machine-facing half of the git surface (openspec `repositories`
 * "Executors expose typed git operations"): one git or `fs.stat` method sent to
 * a Machine's daemon, and every path its answer carries rendered as the
 * canonical `machine://<name>/<abs>` locator. Every git call leaves the process
 * this way, the host Machine's included; `executor-git.service` decides which
 * Machine an address runs on.
 */

import path from 'node:path';

import {
  DEFAULT_GIT_TIMEOUT_MS,
  WORKTREE_ADD_TIMEOUT_MS,
} from '@workspace/git-executor';
import {
  type FsStatResult,
  type GitMethod,
  type JsonValue,
  type MachineMethodParams,
  type NativeDisplayOptions,
  type RequestEnvelope,
} from '@workspace/machine-protocol';

import { dispatchFailure } from './dispatch-failure';
import { ExecutorGitError } from './executor-git-error';
import { formatMachineLocator, MACHINE_SCHEME } from './machine-locator';
import { type MachineConnector } from './machine-connector.service';
import { readFsStatResult } from './machine-results';

/** The round-trip margin added to a daemon operation's own deadline. */
const MACHINE_MARGIN_MS = 15_000;

/**
 * The budget one Machine git call carries: the daemon's longest operation plus
 * the round trip, so the daemon's own typed timeout answers first instead of
 * the hub's budget. A cancelled or expired call still ends git, because the
 * request signal reaches every subcommand.
 */
export const MACHINE_GIT_BUDGET_MS =
  WORKTREE_ADD_TIMEOUT_MS + MACHINE_MARGIN_MS;

/** One `git.state` call's budget, unless the caller named its own timeout. */
export function machineGitBudget(timeoutMs: number | undefined): number {
  return (timeoutMs ?? DEFAULT_GIT_TIMEOUT_MS) + MACHINE_MARGIN_MS;
}

/** The stored form of one path on a Machine: its canonical locator. */
export function machineAddress(machine: string, value: string): string {
  const locator = formatMachineLocator(machine, value);

  if (locator === undefined) {
    throw new ExecutorGitError(
      'invalid_path',
      'This path cannot be written as a Machine locator.',
    );
  }

  return locator;
}

/** The daemon's `fs.stat` answer for one path, or the typed failure. */
export async function statOn(
  connector: MachineConnector,
  machine: string,
  machinePath: string,
): Promise<FsStatResult> {
  let answer: JsonValue;

  try {
    answer = await connector.request(machine, 'fs.stat', {
      envelope: { budgetMs: MACHINE_GIT_BUDGET_MS },
      path: machinePath,
    });
  } catch (error) {
    throw dispatchFailure(machine, 'fs.stat', error);
  }

  const entry = readFsStatResult(answer);

  if (entry === undefined) {
    throw new ExecutorGitError(
      'git_failed',
      `The Machine ${machine} answered an unusable fs.stat result.`,
    );
  }

  return entry;
}

/** The daemon's real path for one directory, in its canonical locator form. */
export async function machineCanonical(
  connector: MachineConnector,
  machine: string,
  machinePath: string,
): Promise<string> {
  const entry = await statOn(connector, machine, machinePath);

  if (entry.kind === 'missing') {
    throw new ExecutorGitError(
      'invalid_path',
      'The checkout path does not exist.',
    );
  }

  if (entry.kind !== 'directory') {
    throw new ExecutorGitError(
      'not_a_directory',
      'The checkout path is not a directory.',
    );
  }

  const canonical =
    entry.realPath === undefined
      ? undefined
      : formatMachineLocator(machine, entry.realPath);

  if (canonical === undefined) {
    throw new ExecutorGitError(
      'git_failed',
      `The Machine ${machine} answered no real path for fs.stat.`,
    );
  }

  return canonical;
}

/** The daemon's real path for an existing ancestor of one future directory. */
export async function machineCanonicalTarget(
  connector: MachineConnector,
  machine: string,
  segments: ReadonlyArray<string>,
): Promise<string> {
  for (let end = segments.length; end >= 1; end -= 1) {
    const entry = await statOn(
      connector,
      machine,
      `/${segments.slice(0, end).join('/')}`,
    );

    if (entry.kind === 'missing') continue;

    if (entry.kind !== 'directory' || entry.realPath === undefined) {
      throw new ExecutorGitError(
        'invalid_path',
        'A worktree parent on this Machine is not a directory.',
      );
    }

    return machineAddress(
      machine,
      path.posix.join(entry.realPath, ...segments.slice(end)),
    );
  }

  // No ancestor exists, so the whole path is still the caller's: render it in
  // the same locator form every other Machine answer uses.
  return machineAddress(machine, `/${segments.join('/')}`);
}

/** One git method's request builder and answer reader. */
export type MachineGitCall<M extends GitMethod, T> = {
  readonly build: (
    envelope: RequestEnvelope,
    options: NativeDisplayOptions,
  ) => MachineMethodParams[M];
  readonly read: (value: JsonValue, machine: string) => T | undefined;
  readonly signal?: AbortSignal;
  readonly budgetMs?: number;
};

/**
 * One git method on one Machine, narrowed to its typed result: the envelope and
 * the display prefix are the same for every method, because the prefix is what
 * turns each path field and each standard-error root prefix into a locator
 * before it leaves the daemon, and the budget covers the daemon's longest
 * operation.
 */
export async function askGit<M extends GitMethod, T>(
  connector: MachineConnector,
  machine: string,
  method: M,
  call: MachineGitCall<M, T>,
): Promise<T> {
  let answer: JsonValue;

  try {
    answer = await connector.request(
      machine,
      method,
      call.build(
        { budgetMs: call.budgetMs ?? MACHINE_GIT_BUDGET_MS },
        { displayPrefix: `${MACHINE_SCHEME}://${machine}` },
      ),
      { signal: call.signal },
    );
  } catch (error) {
    throw dispatchFailure(machine, method, error);
  }

  const result = call.read(answer, machine);

  if (result === undefined) {
    throw new ExecutorGitError(
      'git_failed',
      `The Machine ${machine} answered an unusable ${method} result.`,
    );
  }

  return result;
}
