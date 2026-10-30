import { HttpException, Inject, Injectable } from '@nestjs/common';
import {
  type GitFailure,
  type GitInspectSuccess,
} from '@workspace/git-executor';

import {
  type Checkout,
  type CheckoutKind,
  type Repository,
} from '../db/schema';
import { TenantDbService } from '../db/tenant-db.service';
import { InstanceConfigService } from '../instance-config/instance-config.service';
import { ExecutorGitError } from '../machines/executor-git-error';
import {
  ExecutorGit,
  type ExecutorTarget,
} from '../machines/executor-git.service';
import { decidePermission, OWNER_ROUTE } from '../tools/permissions/admit';
import { projectNativeFilePath } from '../tools/permissions/locator-projection';
import { TOOL_PERMISSION_POLICY } from '../tools/permissions/permission-policy.module';
import { type CompiledPolicy } from '../tools/permissions/types';
import { derivedDisplayName } from './display-name';
import { checkoutFailureCode, notFound, repositoryFailure } from './failure';
import { canonicalOrigin, normalizeRemote } from './remote';
import { RepositoriesRepository } from './repositories.repository';

/*
 * Checkout registration (design D4).
 *
 * The order is load-bearing and mirrors `enter_workspace`: refuse an
 * unconfigured executor and a missing allowlist entry before anything else,
 * decide the SUBMITTED path before any filesystem probe, decide the canonical
 * path before any git call, then inspect, decide the inspected main clone, and
 * only then write. A route therefore never probes a host path the owner may not
 * enter, and the inspected origin — never a caller's claim — decides which
 * repository the checkout joins.
 *
 * The executor is derived from the submitted path: an absolute local path runs
 * in-process on this process's `tools.nativeExecutorId`, and a
 * `machine://<name>/<abs>` locator reaches that Machine through the protocol.
 * Both store the address form in `checkouts.path`: the absolute path locally,
 * the locator on a Machine, which is the same text a bound root carries.
 */

export type RegisterCheckoutInput = {
  /** One absolute local path, or one `machine://<name>/<abs>` locator. */
  readonly path: string;
  /** Selects an existing repository of the owner; inspection is the authority. */
  readonly repositoryId?: string | null;
  /** A normalized-by-this-service remote that selects one repository. */
  readonly remote?: string | null;
};

type RegistrationPlan = {
  readonly executorId: string;
  readonly inspection: GitInspectSuccess;
  /** The canonical address stored: the toplevel the executor reports. */
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
    private readonly executors: ExecutorGit,
    @Inject(TOOL_PERMISSION_POLICY)
    private readonly policy: CompiledPolicy,
  ) {}

  async register(
    ownerUserId: string,
    input: RegisterCheckoutInput,
  ): Promise<Checkout> {
    const plan = await this.planInspection(input.path).catch(
      (error: unknown) => {
        // A refusal of the executor surface is the same typed failure the
        // routes answer: an unconfigured executor, an unreachable or outdated
        // Machine, a refused address, or a failed git call.
        throw error instanceof ExecutorGitError
          ? repositoryFailure(checkoutFailureCode(error.code), error.message)
          : error;
      },
    );
    return this.tenantDb.runAs(ownerUserId, (tx) =>
      this.store(new RepositoriesRepository(tx), ownerUserId, input, plan),
    );
  }

  private async planInspection(
    submittedPath: string,
  ): Promise<RegistrationPlan> {
    const target = this.executors.locate(submittedPath);
    if (!this.config.config.tools.allowed.includes(WORKSPACE_TOOL_ID)) {
      throw repositoryFailure(
        'tool_not_allowed',
        `${WORKSPACE_TOOL_ID} is not in tools.allowed, so this path may not be inspected.`,
      );
    }
    // The address form is what policy matches: a Machine locator is never
    // admitted by a rule written against the local filesystem.
    const submitted = this.executors.address(target, target.path);
    this.requirePathAllowed(submitted);

    // Every path this route probes has been admitted by the operator's policy
    // in its submitted form, and its canonical form is admitted again below.
    // The canonical form is decided before any git call: `realpath` locally,
    // and the daemon's own `fs.stat` real path on a Machine, as
    // `enter_workspace` decides a root before it binds one.
    const canonicalPath = await this.executors.canonical(target, submitted);
    if (canonicalPath !== submitted) this.requirePathAllowed(canonicalPath);

    const inspection = await this.inspect(target, canonicalPath);
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
      executorId: target.executorId,
      inspection,
      checkoutPath: inspection.toplevel,
      mainClone,
      canonicalRemote: canonicalOrigin(inspection.remotes),
    };
  }

  /**
   * One path under the `enter_workspace` group. An owner HTTP route has no Run
   * and no permission mode, so it decides under {@link OWNER_ROUTE}: the group
   * is always evaluated, with the same projection, and refuses whenever
   * nothing allows the path.
   */
  private requirePathAllowed(value: string): void {
    const decision = decidePermission(this.policy, OWNER_ROUTE, (evaluate) =>
      evaluate({
        toolId: WORKSPACE_TOOL_ID,
        args: { path: projectNativeFilePath(value) },
      }),
    );
    if (decision.decision === 'reject') {
      throw repositoryFailure(
        'permission_denied',
        'The host access policy does not allow this path.',
      );
    }
  }

  private async inspect(
    target: ExecutorTarget,
    address: string,
  ): Promise<GitInspectSuccess> {
    const result = await this.executors.inspect(target, address);
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

function gitInspectionFailure(result: GitFailure): HttpException {
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
