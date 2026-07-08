// Mirrors apps/api/src/identity/dto/identity.dto.ts and
// apps/api/src/db/schema/identity.ts's org_role/org_unit_type enums. Kept as
// plain types here (no codegen yet — SPEC §22.0 defers client/SDK codegen
// post-v0.1), so any drift from the API surface must be caught by hand or by
// the e2e, not a type-checker across the wire.

/** Full SPEC §7.3 role vocabulary, as returned in response payloads. */
export const ORG_ROLES = [
  "owner",
  "admin",
  "maintainer",
  "member",
  "viewer",
  "guest",
  "service_account",
] as const;
export type OrgRole = (typeof ORG_ROLES)[number];

/** Grantable/settable via HTTP (D3): every role except `service_account`. */
export const GRANTABLE_ROLES = ORG_ROLES.filter(
  (role) => role !== "service_account",
) as Exclude<OrgRole, "service_account">[];
export type GrantableRole = (typeof GRANTABLE_ROLES)[number];

export type OrgUnitType =
  | "organization"
  | "group"
  | "team"
  | "department"
  | "project";

export type OrgUnitResponse = {
  id: string;
  parentId: string | null;
  name: string;
  type: OrgUnitType;
  /** Materialized id-path (root/child/…) — parent-before-child sort order. */
  path: string;
  settings: Record<string, unknown>;
  createdAt: string;
};

export type MembershipResponse = {
  id: string;
  userId: string;
  orgUnitId: string;
  role: OrgRole;
  createdAt: string;
};

/** `GET /org-units/:id/memberships/me` response — nearest-wins effective role. */
export type EffectiveRoleResponse = {
  role: OrgRole;
  viaOrgUnitId: string;
  inherited: boolean;
};
