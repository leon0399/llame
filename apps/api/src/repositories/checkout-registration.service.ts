import path from 'node:path';
import { realpath, stat } from 'node:fs/promises';

import { HttpException, Inject, Injectable } from '@nestjs/common';
import {
  type GitInspectFailure,
  type GitInspectSuccess,
} from '@workspace/git-executor';

import { pgErrorCode } from '../db/pg-error';
import {
  type Checkout,
  type CheckoutKind,
  type Repository,
} from '../db/schema';
import { TenantDbService } from '../db/tenant-db.service';
import { InstanceConfigService } from '../instance-config/instance-config.service';
import { isMachineLocator } from '../machines/machine-locator';
import { TOOL_PERMISSION_POLICY } from '../tools/permissions/permission-policy.module';
import { type CompiledPolicy } from '../tools/permissions/types';
import { derivedDisplayName } from './display-name';
import { notFound, repositoryFailure } from './failure';
import { GIT_INSPECTOR, type GitInspector } from './git-inspector';
import { canonicalOrigin, normalizeRemote } from './remote';
import { RepositoriesRepository } from './repositories.repository';
import {
  requireWorkspacePathAllowed,
  requireWorkspaceToolAllowed,
} from './workspace-access';

/**
 * Checkout registration for the local executor (design D4).
 *
 * The order is load-bearing and mirrors `enter_workspace`: refuse an
 * unconfigured executor and a missing allowlist entry before anything else,
 * decide the SUBMITTED path before any filesystem probe, decide the canonical
 * path before any git call, then inspect, decide the inspected main clone, and
 * only then write. A route therefore never probes a host path the owner may
 * not enter, and the inspected origin — never a caller's claim — decides which
 * repository the checkout joins.
 */

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
  readonly canonicalPath: string;
  readonly inspection: GitInspectSuccess;
};

type RepositoryResolution = {
  readonly db: RepositoriesRepository;
  readonly ownerUserId: string;
  readonly input: RegisterCheckoutInput;
  readonly plan: RegistrationPlan;
  readonly canonicalRemote: string | null;
};

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
      throw invalidPath('A checkout path must not contain a NUL byte.');
    }
    if (isMachineLocator(submittedPath)) {
      throw executorUnavailable(
        'A Machine path cannot be inspected by this hub yet; register it on a Machine that serves the git methods.',
      );
    }
    if (!path.isAbsolute(submittedPath)) {
      throw invalidPath('A checkout path must be absolute.');
    }
    const executorId = this.config.config.tools.nativeExecutorId;
    if (executorId === undefined) {
      throw executorUnavailable(
        'The serving process holds no tools.nativeExecutorId, so it cannot inspect a local path.',
      );
    }
    return executorId;
  }

  private async planInspection(
    submittedPath: string,
  ): Promise<RegistrationPlan> {
    const executorId = this.localExecutor(submittedPath);
    requireWorkspaceToolAllowed(this.config.config.tools.allowed);
    requireWorkspacePathAllowed(this.policy, submittedPath);

    const canonicalPath = await canonicalDirectory(submittedPath);
    requireWorkspacePathAllowed(this.policy, canonicalPath);

    const inspection = await this.inspect(canonicalPath);
    // A linked worktree is registered under its main clone, which is the path
    // the worktree row's parent is stored at.
    const mainClone = inspection.linked
      ? (inspection.mainWorktree ?? inspection.toplevel)
      : inspection.toplevel;
    if (mainClone !== canonicalPath) {
      requireWorkspacePathAllowed(this.policy, mainClone);
    }
    return { executorId, canonicalPath, inspection };
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
    const canonicalRemote = canonicalOrigin(plan.inspection.remotes);
    const repository = await this.resolveRepository({
      db,
      ownerUserId,
      input,
      plan,
      canonicalRemote,
    });
    return this.createCheckout(db, ownerUserId, plan, repository);
  }

  /** The one write of a registration: the row, or the conflict it earns. */
  private async createCheckout(
    db: RepositoriesRepository,
    ownerUserId: string,
    plan: RegistrationPlan,
    repository: Repository,
  ): Promise<Checkout> {
    if (
      (await db.findCheckoutByPath(
        ownerUserId,
        plan.executorId,
        plan.canonicalPath,
      )) !== undefined
    ) {
      throw pathTaken();
    }
    const kind: CheckoutKind = plan.inspection.linked ? 'worktree' : 'main';
    const parent =
      kind === 'worktree'
        ? await this.mainParent(db, ownerUserId, repository, plan)
        : undefined;
    try {
      return await db.createCheckout({
        ownerUserId,
        repositoryId: repository.id,
        executorId: plan.executorId,
        path: plan.canonicalPath,
        kind,
        parentCheckoutId: parent?.id ?? null,
        branch: plan.inspection.branch,
        origin: 'registered',
      });
    } catch (error) {
      if (pgErrorCode(error) === '23505') throw pathTaken();
      throw error;
    }
  }

  private async resolveRepository(
    request: RepositoryResolution,
  ): Promise<Repository> {
    const { db, ownerUserId, input, plan, canonicalRemote } = request;
    if (
      input.repositoryId !== undefined &&
      input.repositoryId !== null &&
      normalizeRemote(input.remote ?? '') !== ''
    ) {
      throw repositoryFailure(
        'unprocessable',
        'invalid_selector',
        'Submit repositoryId or remote as the selector, not both.',
      );
    }
    if (input.repositoryId !== undefined && input.repositoryId !== null) {
      return this.declaredRepository(request, input.repositoryId);
    }

    const selector = normalizeRemote(input.remote ?? '');
    if (selector !== '') return this.selectedRepository(request, selector);

    if (canonicalRemote === null) {
      // A clone without an origin takes its identity from this first checkout.
      return db.createRepository({
        ownerUserId,
        displayName: derivedDisplayName(null, plan.inspection.toplevel),
        canonicalRemote: null,
      });
    }
    return this.adoptByRemote(db, ownerUserId, plan, canonicalRemote);
  }

  /** A `repositoryId` selector: an owner row that the origin must agree with. */
  private async declaredRepository(
    request: RepositoryResolution,
    repositoryId: string,
  ): Promise<Repository> {
    const { db, ownerUserId, canonicalRemote } = request;
    const declared = await db.findRepository(ownerUserId, repositoryId);
    if (declared === undefined) throw notFound();
    await this.requireOriginMatches(db, ownerUserId, declared, canonicalRemote);
    return declared;
  }

  /** A `remote` selector: the canonical remote first, then a declared alias. */
  private async selectedRepository(
    request: RepositoryResolution,
    selector: string,
  ): Promise<Repository> {
    const { db, ownerUserId, canonicalRemote } = request;
    const selected =
      (await db.findRepositoryByRemote(ownerUserId, selector)) ??
      (await db.findRepositoryByAlias(ownerUserId, selector));
    if (selected === undefined) throw notFound();
    await this.requireOriginMatches(db, ownerUserId, selected, canonicalRemote);
    return selected;
  }

  /**
   * The inspected origin selects the repository, and a clone of an already
   * aliased remote joins the repository that alias names. Two concurrent
   * adoptions of one clone resolve on the unique remote key: the loser re-reads
   * the winner's row.
   */
  private async adoptByRemote(
    db: RepositoriesRepository,
    ownerUserId: string,
    plan: RegistrationPlan,
    canonicalRemote: string,
  ): Promise<Repository> {
    const existing =
      (await db.findRepositoryByRemote(ownerUserId, canonicalRemote)) ??
      (await db.findRepositoryByAlias(ownerUserId, canonicalRemote));
    if (existing !== undefined) return existing;
    try {
      return await db.createRepository({
        ownerUserId,
        displayName: derivedDisplayName(
          canonicalRemote,
          plan.inspection.toplevel,
        ),
        canonicalRemote,
      });
    } catch (error) {
      if (pgErrorCode(error) === '23505') {
        const winner = await db.findRepositoryByRemote(
          ownerUserId,
          canonicalRemote,
        );
        if (winner !== undefined) return winner;
      }
      throw error;
    }
  }

  private async requireOriginMatches(
    db: RepositoriesRepository,
    ownerUserId: string,
    repository: Repository,
    canonicalRemote: string | null,
  ): Promise<void> {
    if (
      canonicalRemote === null ||
      repository.canonicalRemote === canonicalRemote
    ) {
      return;
    }
    const aliases = await db.listAliases(ownerUserId, repository.id);
    if (aliases.some((alias) => alias.canonicalAlias === canonicalRemote)) {
      return;
    }
    throw repositoryFailure(
      'unprocessable',
      'origin_mismatch',
      'The inspected origin does not match the declared repository.',
    );
  }

  /** The main clone a linked worktree belongs to, adopted when unregistered. */
  private async mainParent(
    db: RepositoriesRepository,
    ownerUserId: string,
    repository: Repository,
    plan: RegistrationPlan,
  ): Promise<Checkout> {
    const mainClone = plan.inspection.mainWorktree ?? plan.inspection.toplevel;
    const existing = await db.findCheckoutByPath(
      ownerUserId,
      plan.executorId,
      mainClone,
    );
    return existing === undefined
      ? this.adoptMainRow(db, {
          ownerUserId,
          repositoryId: repository.id,
          executorId: plan.executorId,
          path: mainClone,
        })
      : requireMainRow(existing);
  }

  /**
   * Record the main clone of a linked worktree. The row is intent, so its
   * branch stays null: this inspection read the worktree's HEAD, not the main
   * clone's. A concurrent adoption re-reads the winner's row.
   */
  private async adoptMainRow(
    db: RepositoriesRepository,
    values: {
      readonly ownerUserId: string;
      readonly repositoryId: string;
      readonly executorId: string;
      readonly path: string;
    },
  ): Promise<Checkout> {
    try {
      return await db.createCheckout({
        ...values,
        kind: 'main',
        parentCheckoutId: null,
        branch: null,
        origin: 'adopted',
      });
    } catch (error) {
      if (pgErrorCode(error) === '23505') {
        const winner = await db.findCheckoutByPath(
          values.ownerUserId,
          values.executorId,
          values.path,
        );
        if (winner !== undefined) return winner;
      }
      throw error;
    }
  }
}

function requireMainRow(checkout: Checkout): Checkout {
  if (checkout.kind !== 'main') {
    throw repositoryFailure(
      'unprocessable',
      'invalid_path',
      'The main clone path is already recorded as a worktree.',
    );
  }
  return checkout;
}

/** The canonical directory the submitted path resolves to. */
async function canonicalDirectory(submittedPath: string): Promise<string> {
  try {
    const canonicalPath = await realpath(submittedPath);
    const target = await stat(canonicalPath);
    if (!target.isDirectory()) {
      throw repositoryFailure(
        'unprocessable',
        'not_a_directory',
        'The checkout path is not a directory.',
      );
    }
    return canonicalPath;
  } catch (error) {
    if (error instanceof HttpException) throw error;
    throw repositoryFailure(
      'not_found',
      'not_found',
      'The checkout path does not exist.',
    );
  }
}

function gitInspectionFailure(result: GitInspectFailure) {
  switch (result.type) {
    case 'invalid_input':
      return repositoryFailure('unprocessable', 'invalid_path', result.message);
    case 'not_a_repository':
      return repositoryFailure(
        'unprocessable',
        'not_a_repository',
        'The path holds no git repository.',
      );
    case 'timed_out':
      return repositoryFailure(
        'bad_gateway',
        'git_failed',
        'Inspection did not finish within its timeout.',
      );
    default:
      return repositoryFailure(
        'bad_gateway',
        'git_failed',
        result.stderr === ''
          ? 'Inspection failed.'
          : `Inspection failed: ${result.stderr}`,
      );
  }
}

function invalidPath(message: string) {
  return repositoryFailure('unprocessable', 'invalid_path', message);
}

function executorUnavailable(message: string) {
  return repositoryFailure('unavailable', 'executor_unavailable', message);
}

function pathTaken() {
  return repositoryFailure(
    'conflict',
    'path_taken',
    'This executor path is already one of your checkouts.',
  );
}
