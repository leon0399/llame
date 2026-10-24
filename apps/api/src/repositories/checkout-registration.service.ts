import { realpath, stat } from 'node:fs/promises';
import path from 'node:path';

import { HttpException, Inject, Injectable } from '@nestjs/common';
import {
  type GitInspectFailure,
  type GitInspectResult,
  type GitInspectSuccess,
} from '@workspace/git-executor';

import {
  type Checkout,
  type CheckoutKind,
  type Repository,
} from '../db/schema';
import { TenantDbService } from '../db/tenant-db.service';
import { InstanceConfigService } from '../instance-config/instance-config.service';
import { isMachineLocator } from '../machines/machine-locator';
import { evaluatePermission } from '../tools/permissions/evaluator';
import { projectNativeFilePath } from '../tools/permissions/locator-projection';
import { TOOL_PERMISSION_POLICY } from '../tools/permissions/permission-policy.module';
import { type CompiledPolicy } from '../tools/permissions/types';
import { derivedDisplayName } from './display-name';
import { notFound, repositoryFailure } from './failure';
import { canonicalOrigin, normalizeRemote } from './remote';
import { RepositoriesRepository } from './repositories.repository';

/*
 * Checkout registration for the local executor (design D4).
 *
 * The order is load-bearing and mirrors `enter_workspace`: refuse an
 * unconfigured executor and a missing allowlist entry before anything else,
 * decide the SUBMITTED path before any filesystem probe, decide the canonical
 * path before any git call, then inspect, decide the inspected main clone, and
 * only then write. A route therefore never probes a host path the owner may not
 * enter, and the inspected origin — never a caller's claim — decides which
 * repository the checkout joins.
 */

/** The token of the in-process git surface, so a suite can substitute a fake. */
export const GIT_INSPECTOR = Symbol('GIT_INSPECTOR');

export type GitInspector = {
  inspect(path: string): Promise<GitInspectResult>;
};

export type RegisterCheckoutInput = {
  /** One absolute local path in this layer. */
  readonly path: string;
  /** Selects an existing repository of the owner; inspection is the authority. */
  readonly repositoryId?: string | null;
  /** A normalized-by-this-service remote that selects one repository. */
  readonly remote?: string | null;
};

type RegistrationPlan = {
  readonly executorId: string;
  readonly inspection: GitInspectSuccess;
  /** The canonical path stored: the toplevel the executor reports. */
  readonly checkoutPath: string;
  /** The main clone a linked worktree belongs to, and its parent row's path. */
  readonly mainClone: string;
  /** The normalized `origin` remote, or `null` for a clone without one. */
  readonly canonicalRemote: string | null;
};

/** The one tool group these routes are gated by. */
const WORKSPACE_TOOL_ID = 'enter_workspace';

@Injectable()
export class CheckoutRegistrationService {
  constructor(
    private readonly tenantDb: TenantDbService,
    // Explicit token: the parameter is narrowed to the reader capability, so
    // the emitted design type is not the class Nest would resolve.
    @Inject(InstanceConfigService)
    private readonly config: Pick<InstanceConfigService, 'config'>,
    @Inject(GIT_INSPECTOR)
    private readonly inspector: GitInspector,
    @Inject(TOOL_PERMISSION_POLICY)
    private readonly policy: CompiledPolicy,
  ) {}

  async register(
    ownerUserId: string,
    input: RegisterCheckoutInput,
  ): Promise<Checkout> {
    const plan = await this.planInspection(input.path);
    return this.tenantDb.runAs(ownerUserId, (tx) =>
      this.store(new RepositoriesRepository(tx), ownerUserId, input, plan),
    );
  }

  private async planInspection(
    submittedPath: string,
  ): Promise<RegistrationPlan> {
    const executorId = this.localExecutor(submittedPath);
    if (!this.config.config.tools.allowed.includes(WORKSPACE_TOOL_ID)) {
      throw repositoryFailure(
        'tool_not_allowed',
        `${WORKSPACE_TOOL_ID} is not in tools.allowed, so this path may not be inspected.`,
      );
    }
    this.requirePathAllowed(submittedPath);

    // Every path this route probes has been admitted by the operator's policy
    // in its submitted form, and its canonical form is admitted again below.
    const canonicalPath = await this.admittedCanonicalDirectory(submittedPath);
    this.requirePathAllowed(canonicalPath);

    const inspection = await this.inspect(canonicalPath);
    // The stored path is the toplevel git reports, so a subdirectory of a clone
    // records the clone once, and a linked worktree records its own root. Its
    // main clone is the path its parent row is stored at. Both are decided
    // before either is stored — unconditionally, since a repeat of the same
    // decision is free and a path that skipped it would be one a later layer
    // acts on: submitting a subdirectory decides a path the caller never named.
    this.requirePathAllowed(inspection.toplevel);
    const mainClone = inspection.mainWorktree ?? inspection.toplevel;
    this.requirePathAllowed(mainClone);
    return {
      executorId,
      inspection,
      checkoutPath: inspection.toplevel,
      mainClone,
      canonicalRemote: canonicalOrigin(inspection.remotes),
    };
  }

  /**
   * The executor a submitted path runs on. A `machine://` locator names
   * `machine:<name>`, whose git methods arrive with the daemon layer, so this
   * layer refuses it as unavailable rather than storing a row it cannot
   * inspect. A local path needs the serving process's own executor id: a split
   * topology whose API replica is not that executor must not inspect a host
   * path it does not hold.
   */
  private localExecutor(submittedPath: string): string {
    if (submittedPath.includes('\0')) {
      throw repositoryFailure(
        'invalid_path',
        'A checkout path must not contain a NUL byte.',
      );
    }
    if (isMachineLocator(submittedPath)) {
      throw repositoryFailure(
        'executor_unavailable',
        'A Machine path cannot be inspected by this hub yet; register it on a Machine that serves the git methods.',
      );
    }
    if (!path.isAbsolute(submittedPath)) {
      throw repositoryFailure(
        'invalid_path',
        'A checkout path must be absolute.',
      );
    }
    const executorId = this.config.config.tools.nativeExecutorId;
    if (executorId === undefined) {
      throw repositoryFailure(
        'executor_unavailable',
        'The serving process holds no tools.nativeExecutorId, so it cannot inspect a local path.',
      );
    }
    return executorId;
  }

  /**
   * One path under the `enter_workspace` group, in `default` mode. An owner
   * HTTP route has no Run and no permission mode, so it evaluates the group as
   * a `default`-mode call would: no bypass, the same projection, and a refusal
   * whenever nothing allows the path.
   */
  private requirePathAllowed(value: string): void {
    const decision = evaluatePermission(this.policy, {
      toolId: WORKSPACE_TOOL_ID,
      args: { path: projectNativeFilePath(value) },
    });
    if (decision.decision === 'reject') {
      throw repositoryFailure(
        'permission_denied',
        'The host access policy does not allow this path.',
      );
    }
  }

  /**
   * The canonical directory of a path the operator's allow list admits.
   *
   * The admission check is the boundary: `planInspection` refuses the submitted
   * path before this probe, and re-evaluates the canonical path it returns
   * before any git call, so a symlink cannot walk out of the allow list. The
   * probe therefore only ever sees a value the `enter_workspace` policy allows.
   *
   * The path-injection analyzer cannot see through `evaluatePermission`: the
   * policy is compiled from operator configuration at boot, and its matchers
   * are data, not a syntactic check it can model. The suppression names that
   * guard for a reviewer; it does not weaken the runtime check, which the
   * route's tests exercise on both sides of the decision.
   */
  private async admittedCanonicalDirectory(
    submittedPath: string,
  ): Promise<string> {
    // codeql[js/path-injection]
    const canonicalPath = await realpath(submittedPath).catch(() => undefined);
    if (canonicalPath === undefined) {
      throw repositoryFailure(
        'invalid_path',
        'The checkout path does not exist.',
      );
    }
    const target = await stat(canonicalPath).catch(() => undefined);
    if (target === undefined) {
      throw repositoryFailure(
        'invalid_path',
        'The checkout path cannot be read.',
      );
    }
    if (!target.isDirectory()) {
      throw repositoryFailure(
        'not_a_directory',
        'The checkout path is not a directory.',
      );
    }
    return canonicalPath;
  }

  private async inspect(canonicalPath: string): Promise<GitInspectSuccess> {
    const result = await this.inspector.inspect(canonicalPath);
    if (result.status === 'error') throw gitInspectionFailure(result);
    return result;
  }

  private async store(
    db: RepositoriesRepository,
    ownerUserId: string,
    input: RegisterCheckoutInput,
    plan: RegistrationPlan,
  ): Promise<Checkout> {
    const repository = await this.resolveRepository(
      db,
      ownerUserId,
      input,
      plan,
    );
    return this.createCheckout(db, ownerUserId, plan, repository);
  }

  /**
   * The one write of a registration. The unique key is the guard: a conflict
   * rolls the whole transaction back, including an adopted parent, and answers
   * the same 409 a pre-read would have.
   */
  private async createCheckout(
    db: RepositoriesRepository,
    ownerUserId: string,
    plan: RegistrationPlan,
    repository: Repository,
  ): Promise<Checkout> {
    const kind: CheckoutKind = plan.inspection.linked ? 'worktree' : 'main';
    const created = await db.createCheckout({
      ownerUserId,
      repositoryId: repository.id,
      executorId: plan.executorId,
      path: plan.checkoutPath,
      kind,
      parentCheckoutId:
        kind === 'worktree'
          ? (await this.mainParent(db, ownerUserId, repository, plan)).id
          : null,
      branch: plan.inspection.branch,
      origin: 'registered',
    });
    if (created === undefined) {
      throw repositoryFailure(
        'path_taken',
        'This executor path is already one of your checkouts.',
      );
    }
    return created;
  }

  /**
   * The inspected origin decides the repository; a selector only selects, and a
   * mismatch with the origin is a validation error.
   */
  private async resolveRepository(
    db: RepositoriesRepository,
    ownerUserId: string,
    input: RegisterCheckoutInput,
    plan: RegistrationPlan,
  ): Promise<Repository> {
    const selected =
      (input.repositoryId ?? null) !== null ||
      normalizeRemote(input.remote ?? '') !== '';
    return selected
      ? this.selectedRepository(db, ownerUserId, input, plan)
      : this.adoptedRepository(db, ownerUserId, plan);
  }

  /** A `repositoryId` or a `remote`: an owner row the origin must agree with. */
  private async selectedRepository(
    db: RepositoriesRepository,
    ownerUserId: string,
    input: RegisterCheckoutInput,
    plan: RegistrationPlan,
  ): Promise<Repository> {
    const selector = normalizeRemote(input.remote ?? '');
    const declaredId = input.repositoryId ?? null;
    if (declaredId !== null && selector !== '') {
      throw repositoryFailure(
        'invalid_selector',
        'Submit repositoryId or remote as the selector, not both.',
      );
    }
    const selected =
      declaredId !== null
        ? await db.findRepository(ownerUserId, declaredId)
        : ((await db.findRepositoryByRemote(ownerUserId, selector)) ??
          (await db.findRepositoryByAlias(ownerUserId, selector)));
    if (selected === undefined) throw notFound();
    return this.requireOriginMatches(db, ownerUserId, selected, plan);
  }

  /**
   * No selector: the row already recorded at the main clone decides when there
   * is one — a worktree must share its parent's repository, and a remote-less
   * clone keeps the identity its first checkout gave it.
   */
  private async adoptedRepository(
    db: RepositoriesRepository,
    ownerUserId: string,
    plan: RegistrationPlan,
  ): Promise<Repository> {
    const parentRow = await db.findCheckoutByPath(
      ownerUserId,
      plan.executorId,
      plan.mainClone,
    );
    if (parentRow === undefined) return this.adopt(db, ownerUserId, plan);
    const parentRepository = await db.findRepository(
      ownerUserId,
      parentRow.repositoryId,
    );
    if (parentRepository === undefined) throw notFound();
    return this.requireOriginMatches(db, ownerUserId, parentRepository, plan);
  }

  /**
   * The repository the inspected origin names, created when the owner holds
   * none. Two concurrent adoptions of one clone resolve on the unique remote
   * key: the loser reads the winner's committed row. The claim lock covers the
   * other table too, so an alias declared for this remote at the same moment
   * cannot leave two rows naming it.
   */
  private async adopt(
    db: RepositoriesRepository,
    ownerUserId: string,
    plan: RegistrationPlan,
  ): Promise<Repository> {
    const canonicalRemote = plan.canonicalRemote;
    if (canonicalRemote !== null) {
      await db.lockRemoteClaim(ownerUserId, canonicalRemote);
      const existing =
        (await db.findRepositoryByRemote(ownerUserId, canonicalRemote)) ??
        (await db.findRepositoryByAlias(ownerUserId, canonicalRemote));
      if (existing !== undefined) return existing;
    }
    const created = await db.createRepository({
      ownerUserId,
      displayName: derivedDisplayName(
        canonicalRemote,
        plan.inspection.toplevel,
      ),
      canonicalRemote,
    });
    if (created !== undefined) return created;
    if (canonicalRemote === null) {
      // A NULL remote never conflicts on the unique key.
      throw new Error('A remote-less repository cannot lose an insert race.');
    }
    const winner = await db.findRepositoryByRemote(
      ownerUserId,
      canonicalRemote,
    );
    if (winner === undefined) throw notFound();
    return winner;
  }

  private async requireOriginMatches(
    db: RepositoriesRepository,
    ownerUserId: string,
    repository: Repository,
    plan: RegistrationPlan,
  ): Promise<Repository> {
    const canonicalRemote = plan.canonicalRemote;
    if (
      canonicalRemote === null ||
      repository.canonicalRemote === canonicalRemote
    ) {
      return repository;
    }
    const aliases = await db.listAliases(ownerUserId, repository.id);
    if (aliases.some((alias) => alias.canonicalAlias === canonicalRemote)) {
      return repository;
    }
    throw repositoryFailure(
      'origin_mismatch',
      'The inspected origin does not match the declared repository.',
    );
  }

  /**
   * The main clone a linked worktree belongs to, adopted when unregistered. The
   * parent must belong to the same repository, so a main row of another
   * repository refuses the worktree instead of recording a broken pair.
   */
  private async mainParent(
    db: RepositoriesRepository,
    ownerUserId: string,
    repository: Repository,
    plan: RegistrationPlan,
  ): Promise<Checkout> {
    const findByPath = () =>
      db.findCheckoutByPath(ownerUserId, plan.executorId, plan.mainClone);
    const parent =
      (await findByPath()) ??
      (await db.createCheckout({
        ownerUserId,
        repositoryId: repository.id,
        executorId: plan.executorId,
        path: plan.mainClone,
        kind: 'main',
        parentCheckoutId: null,
        // Intent only: this inspection read the worktree's HEAD, not the main
        // clone's.
        branch: null,
        origin: 'adopted',
      })) ??
      // A concurrent registration adopted the parent first; its committed row
      // is visible to this statement.
      (await findByPath());
    if (parent === undefined) throw notFound();
    if (parent.repositoryId !== repository.id || parent.kind !== 'main') {
      throw repositoryFailure(
        'invalid_path',
        'The main clone of this worktree belongs to another repository, or is recorded as a worktree.',
      );
    }
    return parent;
  }
}

function gitInspectionFailure(result: GitInspectFailure): HttpException {
  switch (result.type) {
    case 'invalid_input':
      return repositoryFailure('invalid_path', result.message);
    case 'not_a_repository':
      return repositoryFailure(
        'not_a_repository',
        'The path holds no git repository.',
      );
    case 'timed_out':
      return repositoryFailure(
        'git_failed',
        'Inspection did not finish within its timeout.',
      );
    default:
      return repositoryFailure(
        'git_failed',
        result.stderr === ''
          ? 'Inspection failed.'
          : `Inspection failed: ${result.stderr}`,
      );
  }
}
