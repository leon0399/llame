import { realpath, stat } from 'node:fs/promises';
import path from 'node:path';

import { Inject, Injectable } from '@nestjs/common';
import {
  addWorktree,
  inspectRepository,
  listWorktrees,
  locateRepository,
  removeWorktree,
  stateRepository,
  type GitInspectResult,
  type GitLocateResult,
  type GitStateResult,
  type GitWorktreeAddResult,
  type GitWorktreeListResult,
  type GitWorktreeRemoveResult,
} from '@workspace/git-executor';
import {
  GIT_INSPECT_METHOD,
  GIT_LOCATE_METHOD,
  GIT_STATE_METHOD,
  GIT_WORKTREE_ADD_METHOD,
  GIT_WORKTREE_LIST_METHOD,
  GIT_WORKTREE_REMOVE_METHOD,
  type GitStateParams,
} from '@workspace/machine-protocol';

import { isMachineLocator, parseMachineLocator } from './machine-locator';
import { dispatchFailure } from './dispatch-failure';
import { ExecutorGitError } from './executor-git-error';
import {
  askGit,
  canonicalInspect,
  canonicalLocate,
  canonicalState,
  canonicalWorktreeAdd,
  canonicalWorktreeList,
  machineAddress,
  machineCanonical,
  machineCanonicalTarget,
  machineGitBudget,
  statOn,
} from './executor-git-machine';
import { MachineConnector } from './machine-connector.service';
import {
  readGitInspectResult,
  readGitLocateResult,
  readGitStateResult,
  readGitWorktreeAddResult,
  readGitWorktreeListResult,
  readGitWorktreeRemoveResult,
} from './git-results';

/*
 * The typed git surface of one Machine (openspec `repositories` "Executors
 * expose typed git operations").
 *
 * Every executor is a Machine, and its identifier is the Machine name. The
 * Machine this process hosts is served by the same code path as before —
 * `@workspace/git-executor` in process, after an identity-checked handshake
 * with its own daemon (design D8) — while every other Machine reaches its
 * daemon over the protocol, so one implementation defines the argv, the
 * environment, and the timeout.
 *
 * Every path this surface accepts and returns is a canonical
 * `machine://<name>/<abs>` ADDRESS, the host Machine included. That is the same
 * text a checkout stores, so a caller never converts between the two forms.
 */

/** The git surface of the process that serves the request; a suite overrides
 *  this provider to substitute one operation. */
export const LOCAL_GIT = Symbol('LOCAL_GIT');

/** The in-process git surface, exactly as `@workspace/git-executor` exports it. */
export type LocalGit = {
  readonly inspect: typeof inspectRepository;
  readonly locate: typeof locateRepository;
  readonly state: typeof stateRepository;
  readonly worktreeAdd: typeof addWorktree;
  readonly listWorktrees: typeof listWorktrees;
  readonly removeWorktree: typeof removeWorktree;
};

export function localGitSurface(): LocalGit {
  return {
    inspect: inspectRepository,
    locate: locateRepository,
    state: stateRepository,
    worktreeAdd: addWorktree,
    listWorktrees,
    removeWorktree,
  };
}

/** The Machine one submitted address runs on, and the path it names there. */
export type ExecutorTarget = {
  /** The stored executor identifier: the Machine name. */
  readonly executorId: string;
  /** The Machine that serves it; every executor is a Machine. */
  readonly machine: string;
  /** The path on that Machine, in its own absolute form. */
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

/** The `git.state` inputs the surface forwards, without the display options. */
type StateInput = Pick<
  GitStateParams,
  'gitEntry' | 'limit' | 'submodules' | 'timeoutMs'
>;

@Injectable()
export class ExecutorGit {
  constructor(
    // Explicit token: the parameter is narrowed to the git surface, so the
    // emitted design type is not what Nest would resolve.
    private readonly connector: MachineConnector,
    @Inject(LOCAL_GIT)
    private readonly local: LocalGit,
  ) {}

  /**
   * Derive the Machine and the path from the submitted address: a
   * `machine://<name>/<abs>` locator names its own Machine, and a bare absolute
   * path names `machines.default` (or the Machine the caller names). A locator
   * that names no configured Machine, a bare path with no Machine to resolve it
   * on, and a malformed value all fail here, before any git call.
   */
  locate(submittedPath: string, machine?: string): ExecutorTarget {
    if (submittedPath.includes('\0')) {
      throw new ExecutorGitError(
        'invalid_path',
        'A checkout path must not contain a NUL byte.',
      );
    }

    return isMachineLocator(submittedPath)
      ? this.locateMachine(submittedPath)
      : this.locatePath(submittedPath, machine);
  }

  /** A bare absolute path is `machines.default`'s, or the caller's Machine. */
  private locatePath(
    submittedPath: string,
    machine: string | undefined,
  ): ExecutorTarget {
    if (!path.isAbsolute(submittedPath)) {
      throw new ExecutorGitError(
        'invalid_path',
        'A checkout path must be absolute.',
      );
    }

    const name = machine ?? this.connector.defaultMachine();

    if (name === undefined) {
      throw new ExecutorGitError(
        'executor_unavailable',
        'No machines.default is configured, so a bare path names no Machine.',
      );
    }

    if (!this.connector.isConfigured(name)) {
      throw new ExecutorGitError(
        'executor_unavailable',
        `No Machine named ${name} is configured, so its git surface cannot run.`,
      );
    }

    return { executorId: name, machine: name, path: submittedPath };
  }

  /** A locator names its own Machine, which must be configured here. */
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
      executorId: parsed.name,
      machine: parsed.name,
      path: parsed.path,
    };
  }

  /** The stored form of one path on this Machine: its canonical locator. */
  address(target: ExecutorTarget, executorPath: string): string {
    return machineAddress(target.machine, executorPath);
  }

  /** Whether this process serves the target in process (design D8). */
  private isLocal(target: ExecutorTarget): boolean {
    return target.machine === this.connector.localMachine();
  }

  /**
   * The identity-checked handshake every in-process operation needs: the host
   * runs this code inside a process whose own daemon must be alive and bound to
   * the same instance id a remote one would have to be. `verifyLocal` caches
   * the session, so this is one handshake per link, not one per call.
   */
  private async verifyLocal(
    target: ExecutorTarget,
    method: string,
  ): Promise<void> {
    try {
      await this.connector.verifyLocal();
    } catch (error) {
      throw dispatchFailure(target.machine, method, error);
    }
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
    if (!this.isLocal(target)) {
      return machineCanonical(
        this.connector,
        target.machine,
        this.executorPath(target, address),
      );
    }

    await this.verifyLocal(target, 'fs.stat');

    // codeql[js/path-injection]
    const canonical = await realpath(this.executorPath(target, address)).catch(
      () => undefined,
    );

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

    return this.address(target, canonical);
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

    if (!this.isLocal(target))
      return machineCanonicalTarget(this.connector, target.machine, segments);

    await this.verifyLocal(target, 'fs.stat');

    for (let end = segments.length; end >= 1; end -= 1) {
      const ancestor = `/${segments.slice(0, end).join('/')}`;
      // codeql[js/path-injection]
      const canonical = await realpath(ancestor).catch(() => undefined);

      if (canonical !== undefined)
        return this.address(
          target,
          path.posix.join(canonical, ...segments.slice(end)),
        );
    }

    return this.address(target, `/${segments.join('/')}`);
  }

  /** Whether one address names an entry on its Machine, creating nothing. */
  async exists(target: ExecutorTarget, address: string): Promise<boolean> {
    const value = this.executorPath(target, address);

    if (!this.isLocal(target))
      return (
        (await statOn(this.connector, target.machine, value)).kind !== 'missing'
      );

    await this.verifyLocal(target, 'fs.stat');

    return (await stat(value).catch(() => undefined)) !== undefined;
  }

  async inspect(
    target: ExecutorTarget,
    address: string,
  ): Promise<GitInspectResult> {
    if (this.isLocal(target)) {
      await this.verifyLocal(target, GIT_INSPECT_METHOD);

      return canonicalInspect(
        target.machine,
        await this.local.inspect({ path: this.executorPath(target, address) }),
      );
    }

    return askGit(this.connector, target.machine, GIT_INSPECT_METHOD, {
      build: (envelope, options) => ({
        envelope,
        options,
        path: this.executorPath(target, address),
      }),
      read: readGitInspectResult,
    });
  }

  async locateEntry(
    target: ExecutorTarget,
    address: string,
    options: { readonly signal?: AbortSignal } = {},
  ): Promise<GitLocateResult> {
    if (this.isLocal(target)) {
      await this.verifyLocal(target, GIT_LOCATE_METHOD);

      return canonicalLocate(
        target.machine,
        await this.local.locate(
          { path: this.executorPath(target, address) },
          options,
        ),
      );
    }

    return askGit(this.connector, target.machine, GIT_LOCATE_METHOD, {
      build: (envelope, display) => ({
        envelope,
        options: display,
        path: this.executorPath(target, address),
      }),
      read: readGitLocateResult,
      signal: options.signal,
    });
  }

  async state(
    target: ExecutorTarget,
    address: string,
    input: StateInput,
    options: { readonly signal?: AbortSignal } = {},
  ): Promise<GitStateResult> {
    if (this.isLocal(target)) {
      return this.localState(target, address, input, options);
    }

    const { gitEntry, limit, submodules, timeoutMs } = input;
    const path = this.executorPath(target, address);
    const entry = this.executorPath(target, gitEntry);

    return askGit(this.connector, target.machine, GIT_STATE_METHOD, {
      build: (envelope, display) => ({
        envelope,
        options: display,
        path,
        gitEntry: entry,
        limit,
        submodules,
        timeoutMs,
      }),
      read: readGitStateResult,
      signal: options.signal,
      budgetMs: machineGitBudget(timeoutMs),
    });
  }

  /** The in-process `git.state`, after the identity-checked handshake. */
  private async localState(
    target: ExecutorTarget,
    address: string,
    input: StateInput,
    options: { readonly signal?: AbortSignal },
  ): Promise<GitStateResult> {
    const { gitEntry, limit, submodules, timeoutMs } = input;

    await this.verifyLocal(target, GIT_STATE_METHOD);

    return canonicalState(
      target.machine,
      await this.local.state(
        {
          path: this.executorPath(target, address),
          gitEntry: this.executorPath(target, gitEntry),
          limit,
          submodules,
        },
        { ...options, timeoutMs },
      ),
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
    if (this.isLocal(target)) {
      await this.verifyLocal(target, GIT_WORKTREE_ADD_METHOD);

      return canonicalWorktreeAdd(
        target.machine,
        await this.local.worktreeAdd({
          ...input,
          source: this.executorPath(target, input.source),
          directory: this.executorPath(target, input.directory),
        }),
      );
    }

    return askGit(this.connector, target.machine, GIT_WORKTREE_ADD_METHOD, {
      build: (envelope, options) => ({
        envelope,
        options,
        source: this.executorPath(target, input.source),
        branch: input.branch,
        baseRef: input.baseRef,
        directory: this.executorPath(target, input.directory),
      }),
      read: readGitWorktreeAddResult,
    });
  }

  async worktreeList(
    target: ExecutorTarget,
    address: string,
  ): Promise<GitWorktreeListResult> {
    if (this.isLocal(target)) {
      await this.verifyLocal(target, GIT_WORKTREE_LIST_METHOD);

      return canonicalWorktreeList(
        target.machine,
        await this.local.listWorktrees({
          path: this.executorPath(target, address),
        }),
      );
    }

    return askGit(this.connector, target.machine, GIT_WORKTREE_LIST_METHOD, {
      build: (envelope, options) => ({
        envelope,
        options,
        source: this.executorPath(target, address),
      }),
      read: readGitWorktreeListResult,
    });
  }

  async removeWorktree(
    target: ExecutorTarget,
    address: string,
  ): Promise<GitWorktreeRemoveResult> {
    if (this.isLocal(target)) {
      await this.verifyLocal(target, GIT_WORKTREE_REMOVE_METHOD);

      return this.local.removeWorktree({
        path: this.executorPath(target, address),
      });
    }

    return askGit(this.connector, target.machine, GIT_WORKTREE_REMOVE_METHOD, {
      build: (envelope, options) => ({
        envelope,
        options,
        path: this.executorPath(target, address),
      }),
      read: readGitWorktreeRemoveResult,
    });
  }

  /**
   * The Machine's own path for an address: a locator decodes to the path it
   * names, and a value with no locator scheme is already that path. It is the
   * inverse of {@link address}, and the form placement arithmetic joins onto.
   */
  executorPath(target: ExecutorTarget, address: string): string {
    if (!isMachineLocator(address)) return address;
    const parsed = parseMachineLocator(address);

    if (parsed.kind !== 'path') {
      throw new ExecutorGitError(
        'invalid_path',
        'This address does not name one Machine path.',
      );
    }

    return parsed.path;
  }
}
