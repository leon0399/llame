import path from 'node:path';

import { Inject, Injectable } from '@nestjs/common';
import {
  addWorktree,
  inspectRepository,
  listWorktrees,
  removeWorktree,
  statusRepository,
  type GitInspectResult,
  type GitStatusResult,
  type GitWorktreeAddResult,
  type GitWorktreeListResult,
  type GitWorktreeRemoveResult,
  type WorktreeAddInput,
} from '@workspace/git-executor';
import {
  GIT_INSPECT_METHOD,
  GIT_STATUS_METHOD,
  GIT_WORKTREE_ADD_METHOD,
  GIT_WORKTREE_LIST_METHOD,
  GIT_WORKTREE_REMOVE_METHOD,
  MachineProtocolError,
  type GitMethod,
  type JsonValue,
  type MachineMethodParams,
} from '@workspace/machine-protocol';

import { InstanceConfigService } from '../instance-config/instance-config.service';
import {
  formatMachineLocator,
  isMachineLocator,
  MACHINE_SCHEME,
  machineExecutorId,
  parseMachineLocator,
} from './machine-locator';
import {
  MachineUnavailableError,
  MachineUpdateRequiredError,
} from './machine-session';
import { MachineConnector } from './machine-connector.service';
import {
  readGitInspectResult,
  readGitStatusResult,
  readGitWorktreeAddResult,
  readGitWorktreeListResult,
  readGitWorktreeRemoveResult,
} from './git-results';

/*
 * The typed git surface of one executor (openspec `repositories` "Executors
 * expose typed git operations").
 *
 * An absolute local path runs in-process on the executor of the process that
 * serves the request, and a `machine://<name>/<abs>` locator reaches that
 * Machine through the protocol. Both sides call `@workspace/git-executor`, so
 * one implementation defines the argv, the environment, and the timeout.
 *
 * Every path this surface accepts is an ADDRESS: an absolute host path locally,
 * and the canonical Machine locator on a Machine. That is the same text a
 * checkout stores, so a caller never converts between the two forms.
 */

/** The git surface of the process that serves the request; a suite overrides
 *  this provider to substitute one operation. */
export const LOCAL_GIT = Symbol('LOCAL_GIT');

export type LocalGit = {
  inspect(
    input: { readonly path: string },
    options?: { readonly timeoutMs?: number },
  ): Promise<GitInspectResult>;
  status(
    input: { readonly path: string },
    options?: { readonly timeoutMs?: number },
  ): Promise<GitStatusResult>;
  worktreeAdd(
    input: WorktreeAddInput,
    options?: { readonly timeoutMs?: number },
  ): Promise<GitWorktreeAddResult>;
  listWorktrees(
    input: { readonly path: string },
    options?: { readonly timeoutMs?: number },
  ): Promise<GitWorktreeListResult>;
  removeWorktree(
    input: { readonly path: string },
    options?: { readonly timeoutMs?: number },
  ): Promise<GitWorktreeRemoveResult>;
};

/** The in-process git surface, exactly as `@workspace/git-executor` exports it. */
export function localGitSurface(): LocalGit {
  return {
    inspect: inspectRepository,
    status: statusRepository,
    worktreeAdd: addWorktree,
    listWorktrees,
    removeWorktree,
  };
}

/** The budget one Machine git call carries when the caller has no shorter one. */
export const MACHINE_GIT_BUDGET_MS = 60_000;

/**
 * The codes this surface fails with, each of which the checkout routes answer
 * with the status `repositories/failure.ts` maps it to.
 */
export type ExecutorGitErrorCode =
  | 'invalid_path'
  | 'executor_unavailable'
  | 'machine_unavailable'
  | 'machine_update_required'
  | 'permission_denied'
  | 'git_failed';

export class ExecutorGitError extends Error {
  constructor(
    readonly code: ExecutorGitErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'ExecutorGitError';
  }
}

/** The executor one submitted address runs on, and the path it names there. */
export type ExecutorTarget = {
  /** The stored executor identifier: `tools.nativeExecutorId` or `machine:<name>`. */
  readonly executorId: string;
  /** The Machine name, or undefined for the local executor. */
  readonly machine: string | undefined;
  /** The path on that executor, in its own absolute form. */
  readonly path: string;
};

@Injectable()
export class ExecutorGit {
  constructor(
    // Explicit tokens: both parameters are narrowed capabilities, so the
    // emitted design types are not what Nest would resolve.
    @Inject(InstanceConfigService)
    private readonly config: Pick<InstanceConfigService, 'config'>,
    private readonly connector: MachineConnector,
    @Inject(LOCAL_GIT)
    private readonly local: LocalGit,
  ) {}

  /**
   * Derive the executor from the submitted path: an absolute local path runs on
   * this process's own executor, and a locator names `machine:<name>`. An
   * unset native id, a locator that names no configured Machine, and a
   * malformed locator all fail here, before any git call.
   */
  locate(submittedPath: string): ExecutorTarget {
    if (submittedPath.includes('\0')) {
      throw new ExecutorGitError(
        'invalid_path',
        'A checkout path must not contain a NUL byte.',
      );
    }
    return isMachineLocator(submittedPath)
      ? this.locateMachine(submittedPath)
      : this.locateLocal(submittedPath);
  }

  /** An absolute local path runs on the executor of the serving process. */
  private locateLocal(submittedPath: string): ExecutorTarget {
    if (!path.isAbsolute(submittedPath)) {
      throw new ExecutorGitError(
        'invalid_path',
        'A checkout path must be absolute.',
      );
    }
    const executorId = this.config.config.tools.nativeExecutorId;
    if (executorId === undefined) {
      throw new ExecutorGitError(
        'executor_unavailable',
        'The serving process holds no tools.nativeExecutorId, so it cannot run git for a local path.',
      );
    }
    return { executorId, machine: undefined, path: submittedPath };
  }

  /** A locator names `machine:<name>`, which must be configured here. */
  private locateMachine(submittedPath: string): ExecutorTarget {
    const parsed = parseMachineLocator(submittedPath);
    if (parsed.kind === 'invalid') {
      throw new ExecutorGitError('invalid_path', parsed.message);
    }
    if (parsed.kind !== 'path') {
      throw new ExecutorGitError(
        'invalid_path',
        'A checkout path must name one Machine path.',
      );
    }
    if (parsed.selector !== undefined) {
      throw new ExecutorGitError(
        'invalid_path',
        'A checkout path must not carry a read selector.',
      );
    }
    if (!this.connector.isConfigured(parsed.name)) {
      throw new ExecutorGitError(
        'executor_unavailable',
        `No Machine named ${parsed.name} is configured, so its git surface cannot run.`,
      );
    }
    return {
      executorId: machineExecutorId(parsed.name),
      machine: parsed.name,
      path: parsed.path,
    };
  }

  /** The stored form of one path on this executor: the locator on a Machine. */
  address(target: ExecutorTarget, executorPath: string): string {
    if (target.machine === undefined) return executorPath;
    const locator = formatMachineLocator(target.machine, executorPath);
    if (locator === undefined) {
      throw new ExecutorGitError(
        'invalid_path',
        'This path cannot be written as a Machine locator.',
      );
    }
    return locator;
  }

  async inspect(
    target: ExecutorTarget,
    address: string,
  ): Promise<GitInspectResult> {
    if (target.machine === undefined)
      return this.local.inspect({ path: address });
    return this.ask(
      target.machine,
      GIT_INSPECT_METHOD,
      {
        envelope: { budgetMs: MACHINE_GIT_BUDGET_MS },
        options: { displayPrefix: `${MACHINE_SCHEME}://${target.machine}` },
        path: this.executorPath(target, address),
      },
      readGitInspectResult,
    );
  }

  async status(
    target: ExecutorTarget,
    address: string,
  ): Promise<GitStatusResult> {
    if (target.machine === undefined)
      return this.local.status({ path: address });
    return this.ask(
      target.machine,
      GIT_STATUS_METHOD,
      {
        envelope: { budgetMs: MACHINE_GIT_BUDGET_MS },
        options: { displayPrefix: `${MACHINE_SCHEME}://${target.machine}` },
        path: this.executorPath(target, address),
      },
      readGitStatusResult,
    );
  }

  async worktreeAdd(
    target: ExecutorTarget,
    input: {
      readonly source: string;
      readonly branch: string;
      readonly baseRef?: string;
      readonly directory: string;
    },
  ): Promise<GitWorktreeAddResult> {
    if (target.machine === undefined) return this.local.worktreeAdd(input);
    const params = {
      envelope: { budgetMs: MACHINE_GIT_BUDGET_MS },
      options: { displayPrefix: `${MACHINE_SCHEME}://${target.machine}` },
      source: this.executorPath(target, input.source),
      branch: input.branch,
      directory: this.executorPath(target, input.directory),
    };
    const { baseRef } = input;
    return this.ask(
      target.machine,
      GIT_WORKTREE_ADD_METHOD,
      baseRef === undefined ? params : { ...params, baseRef },
      readGitWorktreeAddResult,
    );
  }

  async listWorktrees(
    target: ExecutorTarget,
    source: string,
  ): Promise<GitWorktreeListResult> {
    if (target.machine === undefined)
      return this.local.listWorktrees({ path: source });
    return this.ask(
      target.machine,
      GIT_WORKTREE_LIST_METHOD,
      {
        envelope: { budgetMs: MACHINE_GIT_BUDGET_MS },
        options: { displayPrefix: `${MACHINE_SCHEME}://${target.machine}` },
        source: this.executorPath(target, source),
      },
      readGitWorktreeListResult,
    );
  }

  async removeWorktree(
    target: ExecutorTarget,
    address: string,
  ): Promise<GitWorktreeRemoveResult> {
    if (target.machine === undefined)
      return this.local.removeWorktree({ path: address });
    return this.ask(
      target.machine,
      GIT_WORKTREE_REMOVE_METHOD,
      {
        envelope: { budgetMs: MACHINE_GIT_BUDGET_MS },
        options: { displayPrefix: `${MACHINE_SCHEME}://${target.machine}` },
        path: this.executorPath(target, address),
      },
      readGitWorktreeRemoveResult,
    );
  }

  /** The executor's own path for an address: a locator decodes to its path. */
  private executorPath(target: ExecutorTarget, address: string): string {
    if (target.machine === undefined) return address;
    const parsed = parseMachineLocator(address);
    if (parsed.kind !== 'path') {
      throw new ExecutorGitError(
        'invalid_path',
        'This address does not name one Machine path.',
      );
    }
    return parsed.path;
  }

  /**
   * One git method on a Machine, with its untrusted answer narrowed to the
   * typed result. The display prefix is what turns every path field and every
   * standard-error root prefix into a locator before it leaves the daemon.
   */
  private async ask<M extends GitMethod, T>(
    machine: string,
    method: M,
    params: MachineMethodParams[M],
    read: (value: JsonValue) => T | undefined,
  ): Promise<T> {
    let answer: JsonValue;
    try {
      answer = await this.connector.request(machine, method, params);
    } catch (error) {
      throw this.dispatchFailure(machine, method, error);
    }
    const result = read(answer);
    if (result === undefined) {
      throw new ExecutorGitError(
        'git_failed',
        `The Machine ${machine} answered an unusable ${method} result.`,
      );
    }
    return result;
  }

  /** A Machine failure as the code the checkout routes answer. */
  private dispatchFailure(
    machine: string,
    method: GitMethod,
    error: unknown,
  ): Error {
    if (error instanceof MachineUpdateRequiredError)
      return new ExecutorGitError('machine_update_required', error.message);
    if (error instanceof MachineUnavailableError)
      return new ExecutorGitError('machine_unavailable', error.message);
    if (error instanceof MachineProtocolError) {
      // A path outside the Machine's registered roots is its refusal of the
      // address, not a git failure.
      return error.code === 'path_not_registered'
        ? new ExecutorGitError('permission_denied', error.message)
        : new ExecutorGitError(
            'git_failed',
            `${method} failed on ${machine}: ${error.message}`,
          );
    }
    return error instanceof Error ? error : new Error(String(error));
  }
}
