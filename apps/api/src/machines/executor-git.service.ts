import { realpath, stat } from 'node:fs/promises';
import path from 'node:path';

import { Inject, Injectable } from '@nestjs/common';
import {
  addWorktree,
  inspectRepository,
  listWorktrees,
  removeWorktree,
  statusRepository,
  WORKTREE_ADD_TIMEOUT_MS,
  type GitInspectResult,
  type GitStatusResult,
  type GitWorktreeAddResult,
  type GitWorktreeListResult,
  type GitWorktreeRemoveResult,
} from '@workspace/git-executor';
import {
  GIT_INSPECT_METHOD,
  GIT_STATUS_METHOD,
  GIT_WORKTREE_ADD_METHOD,
  GIT_WORKTREE_LIST_METHOD,
  GIT_WORKTREE_REMOVE_METHOD,
  MachineProtocolError,
  type FsStatResult,
  type GitMethod,
  type JsonValue,
  type MachineMethodParams,
  type NativeDisplayOptions,
  type RequestEnvelope,
} from '@workspace/machine-protocol';

import { InstanceConfigService } from '../instance-config/instance-config.service';
import {
  formatMachineLocator,
  isMachineLocator,
  MACHINE_SCHEME,
  machineExecutorId,
  parseMachineLocator,
} from './machine-locator';
import { ExecutorGitError } from './executor-git-error';
import {
  MachineUnavailableError,
  MachineUpdateRequiredError,
} from './machine-session';
import { MachineConnector } from './machine-connector.service';
import { readFsStatResult } from './machine-results';
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

/** The in-process git surface, exactly as `@workspace/git-executor` exports it. */
export type LocalGit = {
  readonly inspect: typeof inspectRepository;
  readonly status: typeof statusRepository;
  readonly worktreeAdd: typeof addWorktree;
  readonly listWorktrees: typeof listWorktrees;
  readonly removeWorktree: typeof removeWorktree;
};

export function localGitSurface(): LocalGit {
  return {
    inspect: inspectRepository,
    status: statusRepository,
    worktreeAdd: addWorktree,
    listWorktrees,
    removeWorktree,
  };
}

/**
 * The budget one Machine git call carries: the daemon's longest operation plus
 * the round trip, so the daemon's own typed timeout answers first instead of
 * the hub's budget. A cancelled or expired call still ends git, because the
 * request signal reaches every subcommand.
 */
export const MACHINE_GIT_BUDGET_MS = WORKTREE_ADD_TIMEOUT_MS + 15_000;

/** The executor one submitted address runs on, and the path it names there. */
export type ExecutorTarget = {
  /** The stored executor identifier: `tools.nativeExecutorId` or `machine:<name>`. */
  readonly executorId: string;
  /** The Machine name, or undefined for the local executor. */
  readonly machine: string | undefined;
  /** The path on that executor, in its own absolute form. */
  readonly path: string;
};

/**
 * The segments of one absolute executor path that may not exist yet. An empty,
 * `.`, or `..` segment, or a relative value, would make a lexical ancestor
 * join disagree with the filesystem, so it is refused rather than resolved.
 */
function creatableSegments(value: string): ReadonlyArray<string> | undefined {
  if (!path.posix.isAbsolute(value)) return undefined;
  const segments = value.split('/').filter((segment) => segment !== '');
  return segments.some((segment) => segment === '.' || segment === '..')
    ? undefined
    : segments;
}

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

  /**
   * The canonical address of one existing path, which the policy decides before
   * any git call. Locally that is `realpath`; on a Machine it is the daemon's
   * own `fs.stat` real path, rendered as the locator — the same decision
   * `enter_workspace` makes before it binds a root.
   *
   * The admission check is the boundary: a caller refuses the submitted path
   * before this probe, and re-evaluates the canonical path it returns before any
   * git call, so a symlink cannot walk out of an allow list. The probe therefore
   * only ever sees a value the `enter_workspace` policy allows.
   *
   * The path-injection analyzer cannot see through `decidePermission`: the
   * policy is compiled from operator configuration at boot, and its matchers
   * are data, not a syntactic check it can model. The suppression names that
   * guard for a reviewer; it does not weaken the runtime check, which the
   * route's tests exercise on both sides of the decision.
   */
  async canonical(target: ExecutorTarget, address: string): Promise<string> {
    if (target.machine !== undefined) {
      return this.machineCanonical(
        target.machine,
        this.executorPath(target, address),
      );
    }
    // codeql[js/path-injection]
    const canonical = await realpath(address).catch(() => undefined);
    if (canonical === undefined) {
      throw new ExecutorGitError(
        'invalid_path',
        'The checkout path does not exist.',
      );
    }
    const entry = await stat(canonical).catch(() => undefined);
    if (entry === undefined) {
      throw new ExecutorGitError(
        'invalid_path',
        'The checkout path cannot be read.',
      );
    }
    if (!entry.isDirectory()) {
      throw new ExecutorGitError(
        'not_a_directory',
        'The checkout path is not a directory.',
      );
    }
    return canonical;
  }

  /** The daemon's `fs.stat` answer for one path, or the typed failure. */
  private async statOn(
    machine: string,
    machinePath: string,
  ): Promise<FsStatResult> {
    let answer: JsonValue;
    try {
      answer = await this.connector.request(machine, 'fs.stat', {
        envelope: { budgetMs: MACHINE_GIT_BUDGET_MS },
        path: machinePath,
      });
    } catch (error) {
      throw this.dispatchFailure(machine, 'fs.stat', error);
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
  private async machineCanonical(
    machine: string,
    machinePath: string,
  ): Promise<string> {
    const entry = await this.statOn(machine, machinePath);
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

  /**
   * The canonical address of one path that need not exist yet: its deepest
   * existing ancestor is resolved — `realpath` locally, the daemon's own
   * `fs.stat` real path on a Machine — and the segments below it are appended
   * lexically. A `.` or `..` segment would make that join disagree with the
   * filesystem, so it is refused instead of resolved.
   *
   * This is the form a worktree-directory decision sees, so a symlinked parent
   * decides where it lands, and a Machine that does not register the
   * destination refuses it here before any git call.
   */
  async canonicalTarget(
    target: ExecutorTarget,
    address: string,
  ): Promise<string> {
    const segments = creatableSegments(this.executorPath(target, address));
    if (segments === undefined) {
      throw new ExecutorGitError(
        'invalid_path',
        'A worktree directory must be an absolute path without `.` or `..` segments.',
      );
    }
    const machine = target.machine;
    if (machine !== undefined)
      return this.machineCanonicalTarget({ ...target, machine }, segments);
    for (let end = segments.length; end >= 1; end -= 1) {
      const ancestor = `/${segments.slice(0, end).join('/')}`;
      // codeql[js/path-injection]
      const canonical = await realpath(ancestor).catch(() => undefined);
      if (canonical !== undefined)
        return path.posix.join(canonical, ...segments.slice(end));
    }
    return `/${segments.join('/')}`;
  }

  /** The daemon's real path for an existing ancestor of one future directory. */
  private async machineCanonicalTarget(
    target: ExecutorTarget & { readonly machine: string },
    segments: ReadonlyArray<string>,
  ): Promise<string> {
    for (let end = segments.length; end >= 1; end -= 1) {
      const entry = await this.statOn(
        target.machine,
        `/${segments.slice(0, end).join('/')}`,
      );
      if (entry.kind === 'missing') continue;
      if (entry.kind !== 'directory' || entry.realPath === undefined) {
        throw new ExecutorGitError(
          'invalid_path',
          'A worktree parent on this Machine is not a directory.',
        );
      }
      return this.address(
        target,
        path.posix.join(entry.realPath, ...segments.slice(end)),
      );
    }
    // No ancestor exists, so the whole path is still the caller's: render it in
    // the same locator form every other Machine answer uses.
    return this.address(target, `/${segments.join('/')}`);
  }

  /** Whether one address names an entry on its executor, creating nothing. */
  async exists(target: ExecutorTarget, address: string): Promise<boolean> {
    const value = this.executorPath(target, address);
    if (target.machine !== undefined)
      return (await this.statOn(target.machine, value)).kind !== 'missing';
    return (await stat(value).catch(() => undefined)) !== undefined;
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
      (envelope, options) => ({
        envelope,
        options,
        path: this.executorPath(target, address),
      }),
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
      (envelope, options) => ({
        envelope,
        options,
        path: this.executorPath(target, address),
      }),
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
    return this.ask(
      target.machine,
      GIT_WORKTREE_ADD_METHOD,
      (envelope, options) => ({
        envelope,
        options,
        source: this.executorPath(target, input.source),
        branch: input.branch,
        baseRef: input.baseRef,
        directory: this.executorPath(target, input.directory),
      }),
      readGitWorktreeAddResult,
    );
  }

  async worktreeList(
    target: ExecutorTarget,
    address: string,
  ): Promise<GitWorktreeListResult> {
    if (target.machine === undefined)
      return this.local.listWorktrees({ path: address });
    return this.ask(
      target.machine,
      GIT_WORKTREE_LIST_METHOD,
      (envelope, options) => ({
        envelope,
        options,
        source: this.executorPath(target, address),
      }),
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
      (envelope, options) => ({
        envelope,
        options,
        path: this.executorPath(target, address),
      }),
      readGitWorktreeRemoveResult,
    );
  }

  /**
   * The executor's own path for an address: a locator decodes to the path it
   * names, and a local address is already that path. It is the inverse of
   * {@link address}, and the form placement arithmetic joins onto.
   */
  executorPath(target: ExecutorTarget, address: string): string {
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
   * typed result. The envelope and the display prefix are the same for every
   * method: the prefix is what turns each path field and each standard-error
   * root prefix into a locator before it leaves the daemon, and the budget
   * covers the daemon's longest operation.
   */
  private async ask<M extends GitMethod, T>(
    machine: string,
    method: M,
    build: (
      envelope: RequestEnvelope,
      options: NativeDisplayOptions,
    ) => MachineMethodParams[M],
    read: (value: JsonValue, machine: string) => T | undefined,
  ): Promise<T> {
    let answer: JsonValue;
    try {
      answer = await this.connector.request(
        machine,
        method,
        build(
          { budgetMs: MACHINE_GIT_BUDGET_MS },
          { displayPrefix: `${MACHINE_SCHEME}://${machine}` },
        ),
      );
    } catch (error) {
      throw this.dispatchFailure(machine, method, error);
    }
    const result = read(answer, machine);
    if (result === undefined) {
      throw new ExecutorGitError(
        'git_failed',
        `The Machine ${machine} answered an unusable ${method} result.`,
      );
    }
    return result;
  }

  /** A Machine failure as the code the callers answer. */
  private dispatchFailure(
    machine: string,
    method: string,
    error: unknown,
  ): Error {
    if (error instanceof MachineUpdateRequiredError)
      return new ExecutorGitError('machine_update_required', error.message);
    if (error instanceof MachineUnavailableError)
      // The session's own message is the transport's: an ssh standard error or
      // a socket failure, which the repository routes would answer as the body
      // of an HTTP response. Only the Machine and the reason leave the hub.
      // Only a mutation can leave an effect behind: `sent` on a read would
      // claim an unknown outcome for a request that wrote nothing.
      return new ExecutorGitError(
        'machine_unavailable',
        `The Machine ${machine} is unavailable (${error.reason}).`,
        error.sent &&
          (method === GIT_WORKTREE_ADD_METHOD ||
            method === GIT_WORKTREE_REMOVE_METHOD),
      );
    if (error instanceof MachineProtocolError) {
      // A path outside the Machine's registered roots is its refusal of the
      // address, not a git failure: registration maps that to 403
      // `permission_denied`, and worktree entry answers it under its own code.
      return error.code === 'path_not_registered'
        ? new ExecutorGitError('path_not_registered', error.message)
        : new ExecutorGitError(
            'git_failed',
            `${method} failed on ${machine}: ${error.message}`,
          );
    }
    return error instanceof Error ? error : new Error(String(error));
  }
}
