import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { TenantDbService } from '../db/tenant-db.service';
import { type OrgRole, type OrgUnit, type OrgUnitType } from '../db/schema';
import {
  MembershipsRepository,
  OrgUnitsRepository,
} from './identity-repository';
import { pathIds } from './org-path';
import { resolveEffectiveRole, type EffectiveRole } from './role-resolution';

/**
 * IdentityService (#44, SPEC §7.1–§7.3): org-unit lifecycle and effective-role
 * lookups. This is the surface the policy engine (#45) and config resolver
 * (#46) will call — no HTTP controller yet, deliberately: the module ships
 * with no reachable surface until the admin API slice.
 */
@Injectable()
export class IdentityService {
  constructor(private readonly tenantDb: TenantDbService) {}

  /**
   * Create a root org unit with the creator as its owner — one transaction,
   * so an org can never exist ownerless. RLS admits exactly this pair of
   * writes for a fresh root (creator bootstrap policy).
   */
  async createRootOrg(input: {
    userId: string;
    name: string;
    type?: OrgUnitType;
  }): Promise<OrgUnit> {
    return this.tenantDb.runAs(input.userId, async (tx) => {
      const unit = await new OrgUnitsRepository(tx).createRoot({
        name: input.name,
        ...(input.type ? { type: input.type } : {}),
        createdBy: input.userId,
      });
      await new MembershipsRepository(tx).grant({
        userId: input.userId,
        orgUnitId: unit.id,
        role: 'owner',
      });
      return unit;
    });
  }

  /** Create a child unit under a parent the user can see (RLS-checked). */
  async createChildOrg(input: {
    userId: string;
    parentId: string;
    name: string;
    type?: OrgUnitType;
  }): Promise<OrgUnit> {
    return this.tenantDb.runAs(input.userId, async (tx) => {
      const repo = new OrgUnitsRepository(tx);
      const parent = await repo.findById(input.parentId);
      if (!parent) {
        throw new NotFoundException(`Org unit ${input.parentId} not found`);
      }
      return repo.createChild({
        parent,
        name: input.name,
        ...(input.type ? { type: input.type } : {}),
        createdBy: input.userId,
      });
    });
  }

  /**
   * The user's effective role on a unit (#44 acceptance): explicit membership
   * on the unit, or inherited along the ancestor path — nearest node wins.
   * Null when the user has no membership anywhere on the path (which, under
   * RLS, also means the unit itself is invisible to them unless they created
   * it).
   */
  async resolveRole(input: {
    userId: string;
    orgUnitId: string;
  }): Promise<EffectiveRole | null> {
    return this.tenantDb.runAs(input.userId, async (tx) => {
      const unit = await new OrgUnitsRepository(tx).findById(input.orgUnitId);
      if (!unit) {
        return null;
      }
      const onPath = await new MembershipsRepository(tx).findByUserOnUnits(
        input.userId,
        pathIds(unit.path),
      );
      return resolveEffectiveRole(unit.path, onPath);
    });
  }

  /** The caller's visible org units (RLS: member-on-path or creator). */
  async listOrgUnits(userId: string): Promise<OrgUnit[]> {
    return this.tenantDb.runAs(userId, (tx) =>
      new OrgUnitsRepository(tx).listVisible(),
    );
  }

  /**
   * Grant a role (RLS enforces the caller may grant on this unit). `grant` is
   * INSERT-only, so re-granting an existing member hits the (user,unit) unique
   * index → surfaced as 409, never a silent role change.
   */
  async grantMembership(input: {
    callerId: string;
    userId: string;
    orgUnitId: string;
    role: OrgRole;
  }): Promise<void> {
    try {
      await this.tenantDb.runAs(input.callerId, async (tx) => {
        await new MembershipsRepository(tx).grant({
          userId: input.userId,
          orgUnitId: input.orgUnitId,
          role: input.role,
        });
      });
    } catch (err) {
      // Drizzle wraps the driver error, so the SQLSTATE can be on `.code` OR the
      // wrapped `.cause.code`.
      const code = pgErrorCode(err);
      if (code === '23505') {
        throw new ConflictException(
          'User is already a member of this org unit',
        );
      }
      // FK violation → the target user (or unit) doesn't exist. 404, not a 500.
      if (code === '23503') {
        throw new NotFoundException('User or org unit not found');
      }
      throw err;
    }
  }
}

/** Extract the Postgres SQLSTATE from a raw driver error or a Drizzle wrapper. */
function pgErrorCode(err: unknown): string | undefined {
  const e = err as { code?: string; cause?: { code?: string } };
  return e?.code ?? e?.cause?.code;
}
