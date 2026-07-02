import { type Membership, type OrgRole } from '../db/schema';
import { pathIds } from './org-path';

/** An effective role and the membership that supplies it. */
export type EffectiveRole = {
  role: OrgRole;
  /** The org unit the deciding membership is attached to. */
  viaOrgUnitId: string;
  /** True when the role is inherited from an ancestor, not held on the unit itself. */
  inherited: boolean;
};

/**
 * Effective-role resolution (#44, SPEC §7.2/§7.3): given a unit's path and the
 * user's memberships along that path, the NEAREST membership wins — the most
 * specific node decides. This lets a subtree demote (org-wide admin, viewer in
 * one team) as well as promote. Pure: callers fetch the candidate memberships
 * (one indexed IN query over the path's ids) and pass them in.
 *
 * Deny/allow *policies* are #45 — roles here answer "what are you in this
 * scope", not "may you do X".
 */
export function resolveEffectiveRole(
  path: string,
  membershipsOnPath: Pick<Membership, 'orgUnitId' | 'role'>[],
): EffectiveRole | null {
  const ids = pathIds(path);
  const byUnit = new Map(membershipsOnPath.map((m) => [m.orgUnitId, m.role]));

  // Walk leaf → root: the first (deepest) membership decides.
  for (let i = ids.length - 1; i >= 0; i -= 1) {
    const role = byUnit.get(ids[i]);
    if (role !== undefined) {
      return {
        role,
        viaOrgUnitId: ids[i],
        inherited: i !== ids.length - 1,
      };
    }
  }
  return null;
}

/** Roles allowed to administer a scope (grant, configure). SPEC §7.3. */
export const ADMIN_ROLES: readonly OrgRole[] = ['owner', 'admin'];

export function isAdminRole(role: OrgRole | null | undefined): boolean {
  return role != null && (ADMIN_ROLES as OrgRole[]).includes(role);
}
