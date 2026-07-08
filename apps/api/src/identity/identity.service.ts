import {
  ConflictException,
  ForbiddenException,
  HttpException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';

import { TenantDbService } from '../db/tenant-db.service';
import {
  type Membership,
  type OrgRole,
  type OrgUnit,
  type OrgUnitType,
} from '../db/schema';
import {
  MembershipsRepository,
  OrgUnitsRepository,
} from './identity-repository';
import { pathIds } from './org-path';
import { resolveEffectiveRole, type EffectiveRole } from './role-resolution';

/**
 * Retryable "the tree changed under us" outcome (D1): the deferred
 * path-integrity trigger (23514), or a target row that vanished between an
 * initial visibility check and a later lock-then-reread inside the
 * repository (the residual window the F4 lock-then-verify loop doesn't
 * itself close — see identity-repository.ts). Both are conflicts, not
 * server errors.
 */
function isConcurrentTreeChange(err: unknown): boolean {
  return (
    pgErrorCode(err) === '23514' ||
    (err instanceof Error && /not found/i.test(err.message))
  );
}

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

  /**
   * Create a child unit under a parent the user can see (RLS-checked).
   *
   * D1 race closure: locks the parent's tree root before reading it (not a
   * plain read), so a concurrent `move` anywhere in that tree serializes
   * instead of racing — see `OrgUnitsRepository.findByIdInLockedTree`/`move`.
   */
  async createChildOrg(input: {
    userId: string;
    parentId: string;
    name: string;
    type?: OrgUnitType;
  }): Promise<OrgUnit> {
    try {
      return await this.tenantDb.runAs(input.userId, async (tx) => {
        const repo = new OrgUnitsRepository(tx);
        const parent = await repo.findByIdInLockedTree(input.parentId);
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
    } catch (err) {
      if (err instanceof NotFoundException) {
        throw err;
      }
      // The deferred path-integrity constraint trigger (D1) raises 23514 when
      // a commit would leave this unit's path inconsistent with its parent's
      // current path — the backstop behind the FOR UPDATE lock above, for
      // whatever residual race it doesn't close. Retryable, not a server error.
      if (pgErrorCode(err) === '23514') {
        throw new ConflictException(
          'Org tree changed concurrently — retry the request',
        );
      }
      throw err;
    }
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

  /** Fetch a single unit (RLS: member-on-path or creator); invisible/absent → 404. */
  async getOrgUnit(input: {
    userId: string;
    orgUnitId: string;
  }): Promise<OrgUnit> {
    return this.tenantDb.runAs(input.userId, async (tx) => {
      const unit = await new OrgUnitsRepository(tx).findById(input.orgUnitId);
      if (!unit) {
        throw new NotFoundException(`Org unit ${input.orgUnitId} not found`);
      }
      return unit;
    });
  }

  /**
   * `PATCH /org-units/:id` (D5): rename, replace settings, and/or move —
   * whichever fields are present. One transaction, so a rename alongside a
   * move either both land or neither does.
   *
   * Every sub-write is checked for the RLS zero-rows-under-USING landmine:
   * `findById` up front distinguishes invisible/absent (404) from visible;
   * each write's own zero-rows result (repository docs) then means
   * visible-but-not-permitted (403) — never treated as a silent success.
   *
   * `parentId`: `undefined` = no move, `null` = move to root, a unit id =
   * move under that unit (existence/visibility checked before attempting
   * the move, same 404 contract as the rest of this method).
   */
  async updateOrgUnit(input: {
    userId: string;
    orgUnitId: string;
    name?: string;
    settings?: Record<string, unknown>;
    parentId?: string | null;
  }): Promise<OrgUnit> {
    try {
      return await this.tenantDb.runAs(input.userId, async (tx) => {
        const repo = new OrgUnitsRepository(tx);
        const existing = await repo.findById(input.orgUnitId);
        if (!existing) {
          throw new NotFoundException(`Org unit ${input.orgUnitId} not found`);
        }

        if (input.parentId === null) {
          const moved = await repo.moveToRoot({ id: input.orgUnitId });
          if (!moved) {
            throw new ForbiddenException('Not permitted to move this org unit');
          }
        } else if (input.parentId !== undefined) {
          const newParent = await repo.findById(input.parentId);
          if (!newParent) {
            throw new NotFoundException(`Org unit ${input.parentId} not found`);
          }
          const moved = await repo.move({ id: input.orgUnitId }, newParent);
          if (!moved) {
            throw new ForbiddenException('Not permitted to move this org unit');
          }
        }

        if (input.name !== undefined) {
          const renamed = await repo.rename(input.orgUnitId, input.name);
          if (!renamed) {
            throw new ForbiddenException(
              'Not permitted to rename this org unit',
            );
          }
        }

        if (input.settings !== undefined) {
          const updated = await repo.updateSettings(
            input.orgUnitId,
            input.settings,
          );
          if (!updated) {
            throw new ForbiddenException(
              'Not permitted to update settings on this org unit',
            );
          }
        }

        const result = await repo.findById(input.orgUnitId);
        if (!result) {
          throw new NotFoundException(`Org unit ${input.orgUnitId} not found`);
        }
        return result;
      });
    } catch (err) {
      if (err instanceof HttpException) {
        throw err;
      }
      // Move-into-own-subtree (repository guard) is a validation error, not
      // an authorization or integrity outcome — 422 (spec: "Move into own
      // subtree is rejected").
      if (err instanceof Error && /own subtree/i.test(err.message)) {
        throw new UnprocessableEntityException(err.message);
      }
      if (isConcurrentTreeChange(err)) {
        throw new ConflictException(
          'Org tree changed concurrently — retry the request',
        );
      }
      if (pgErrorCode(err) === '42501') {
        throw new ForbiddenException('Not permitted to update this org unit');
      }
      throw err;
    }
  }

  /**
   * Leaf-only delete (D5: owner-tier on path; FK `RESTRICT` refuses a unit
   * with children). `existing` disambiguates 404 (invisible/absent) from
   * 403 (visible but not owner-tier — the delete's own zero-rows result).
   */
  async deleteOrgUnit(input: {
    userId: string;
    orgUnitId: string;
  }): Promise<void> {
    try {
      await this.tenantDb.runAs(input.userId, async (tx) => {
        const repo = new OrgUnitsRepository(tx);
        const existing = await repo.findById(input.orgUnitId);
        if (!existing) {
          throw new NotFoundException(`Org unit ${input.orgUnitId} not found`);
        }
        const deleted = await repo.delete(input.orgUnitId);
        if (!deleted) {
          throw new ForbiddenException(
            'Owner-tier required to delete this org unit',
          );
        }
      });
    } catch (err) {
      if (err instanceof HttpException) {
        throw err;
      }
      // FK RESTRICT on parent_id — the unit still has children.
      if (pgErrorCode(err) === '23503') {
        throw new ConflictException(
          'Org unit has child units — delete them first',
        );
      }
      throw err;
    }
  }

  /**
   * The roster of a unit (SPEC "Roster visibility for members"): the unit's
   * own visibility gates the whole endpoint (404 when invisible/absent);
   * `memberships_select`'s member-on-path branch (D4) then scopes the rows
   * themselves — a visible-but-non-member caller (the bootstrap edge: sees
   * the unit as its creator, holds no membership) legitimately gets `[]`,
   * not an error.
   */
  async listMemberships(input: {
    userId: string;
    orgUnitId: string;
  }): Promise<Membership[]> {
    return this.tenantDb.runAs(input.userId, async (tx) => {
      const unit = await new OrgUnitsRepository(tx).findById(input.orgUnitId);
      if (!unit) {
        throw new NotFoundException(`Org unit ${input.orgUnitId} not found`);
      }
      return new MembershipsRepository(tx).listByUnit(input.orgUnitId);
    });
  }

  /**
   * `PATCH .../memberships/:userId` (D3/D5). `findByUserAndUnit` first —
   * `memberships_select` (own row OR member-on-path) is strictly broader
   * than `memberships_update`'s USING (admin/owner-tier), so it correctly
   * tells apart "no such membership / invisible" (404) from "visible, but
   * this write's stricter gate denied it" (403 from the zero-rows update).
   */
  async changeMembershipRole(input: {
    callerId: string;
    userId: string;
    orgUnitId: string;
    role: OrgRole;
  }): Promise<Membership> {
    try {
      return await this.tenantDb.runAs(input.callerId, async (tx) => {
        const repo = new MembershipsRepository(tx);
        const existing = await repo.findByUserAndUnit(
          input.userId,
          input.orgUnitId,
        );
        if (!existing) {
          throw new NotFoundException('Membership not found');
        }
        const updated = await repo.changeRole(
          input.userId,
          input.orgUnitId,
          input.role,
        );
        if (!updated) {
          throw new ForbiddenException(
            'Not permitted to change this membership’s role',
          );
        }
        return updated;
      });
    } catch (err) {
      if (err instanceof HttpException) {
        throw err;
      }
      const code = pgErrorCode(err);
      if (code === '42501') {
        throw new ForbiddenException(
          'Not permitted to change this membership’s role',
        );
      }
      // D2's last-owner trigger — demoting the sole owner of a root unit.
      if (code === 'OW001') {
        throw new ConflictException(
          'Cannot remove the last owner of this org — transfer ownership first',
        );
      }
      throw err;
    }
  }

  /**
   * `DELETE .../memberships/:userId` (D5): self-leave or admin/owner-tier
   * revoke. Same existence-then-permission split as `changeMembershipRole`.
   */
  async revokeMembership(input: {
    callerId: string;
    userId: string;
    orgUnitId: string;
  }): Promise<void> {
    try {
      await this.tenantDb.runAs(input.callerId, async (tx) => {
        const repo = new MembershipsRepository(tx);
        const existing = await repo.findByUserAndUnit(
          input.userId,
          input.orgUnitId,
        );
        if (!existing) {
          throw new NotFoundException('Membership not found');
        }
        const revoked = await repo.revoke(input.userId, input.orgUnitId);
        if (!revoked) {
          throw new ForbiddenException(
            'Not permitted to revoke this membership',
          );
        }
      });
    } catch (err) {
      if (err instanceof HttpException) {
        throw err;
      }
      const code = pgErrorCode(err);
      if (code === '42501') {
        throw new ForbiddenException('Not permitted to revoke this membership');
      }
      // D2's last-owner trigger — the sole owner of a root unit leaving/being revoked.
      if (code === 'OW001') {
        throw new ConflictException(
          'Cannot remove the last owner of this org — transfer ownership first',
        );
      }
      throw err;
    }
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
      // RLS WITH CHECK rejected the insert (not owner/admin on an ancestor,
      // or a cross-tenant orgUnitId) — a normal authorization outcome, not a
      // server error.
      if (code === '42501') {
        throw new ForbiddenException(
          'Not permitted to grant membership on this org unit',
        );
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
