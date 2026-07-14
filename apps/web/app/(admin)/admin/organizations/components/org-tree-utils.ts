import {
  Building2Icon,
  NetworkIcon,
  UsersIcon,
  UsersRoundIcon,
  type LucideIcon,
} from "lucide-react";

import type {
  OrgRole,
  OrgUnitResponse,
  OrgUnitType,
} from "@/lib/services/org-units/types";

/** Icon + label per unit type — matches the design's TYPE map exactly (Admin.dc.html). */
export const ORG_UNIT_TYPE_META: Record<
  OrgUnitType,
  { icon: LucideIcon; label: string }
> = {
  organization: { icon: Building2Icon, label: "Organization" },
  group: { icon: UsersIcon, label: "Group" },
  team: { icon: UsersRoundIcon, label: "Team" },
  department: { icon: NetworkIcon, label: "Department" },
};

/** Legend order, and the create-child dialog's type segment (root type is
 * fixed to `organization` — only these three are ever a child's type). */
export const ORG_UNIT_TYPE_ORDER: OrgUnitType[] = [
  "organization",
  "group",
  "team",
  "department",
];
export const CHILD_ORG_UNIT_TYPES: OrgUnitType[] = [
  "group",
  "team",
  "department",
];

/** Full 7-role vocabulary display label (D2 — the design mock omits
 * `service_account`, this doesn't). */
export const ROLE_LABEL: Record<OrgRole, string> = {
  owner: "owner",
  admin: "admin",
  maintainer: "maintainer",
  member: "member",
  viewer: "viewer",
  guest: "guest",
  service_account: "service account",
};

export type GuideKind = "bar" | "blank" | "elbow" | "tee";

export type TreeRow = {
  unit: OrgUnitResponse;
  depth: number;
  guides: GuideKind[];
  hasChildren: boolean;
  open: boolean;
  isRoot: boolean;
  /** True only for the very first row in the whole tree — the design gives
   * every OTHER root row extra top margin to separate root trees, but not
   * the first one (nothing above it to separate from). */
  isFirst: boolean;
};

/**
 * A unit's PARENT for tree-nesting purposes: `null` (i.e. rendered as a
 * root of the visible forest) unless the real parent is also visible to the
 * caller. RLS can grant visibility of a deep unit via a role on the unit
 * itself without granting visibility of its ancestors (no role higher up) —
 * nesting it under an invisible parent isn't renderable, so it becomes a
 * root instead. This must stay a *contiguous* walk (immediate parent only),
 * not "any visible ancestor anywhere in the path": a real tree's guide
 * lines require an unbroken parent-child edge, not just an ancestor that
 * happens to be visible several levels up.
 */
function effectiveParentId(
  unit: OrgUnitResponse,
  visibleIds: Set<string>,
): string | null {
  return unit.parentId && visibleIds.has(unit.parentId) ? unit.parentId : null;
}

function childrenOf(
  units: OrgUnitResponse[],
  visibleIds: Set<string>,
  parentId: string | null,
): OrgUnitResponse[] {
  // The API already returns units in parent-before-child path order (D5),
  // so filtering preserves correct sibling order without re-sorting.
  return units.filter((u) => effectiveParentId(u, visibleIds) === parentId);
}

/**
 * Builds the flat, depth-ordered row list a tree view renders, including
 * each row's connector-guide columns — a straight port of the design's
 * `buildRows`/guide algorithm (Admin.dc.html): for each ancestor column,
 * `bar`/`blank` continues or breaks the vertical line depending on whether
 * that ancestor still had siblings after it, and the immediate-parent
 * column resolves to `elbow` (last child) or `tee` (more siblings follow).
 */
export function buildRows(
  units: OrgUnitResponse[],
  collapsed: Record<string, boolean>,
): TreeRow[] {
  const visibleIds = new Set(units.map((u) => u.id));
  const rows: TreeRow[] = [];

  const walk = (nodes: OrgUnitResponse[], ancestorContinues: boolean[]) => {
    nodes.forEach((unit, i) => {
      const isLast = i === nodes.length - 1;
      const depth = ancestorContinues.length;
      const kids = childrenOf(units, visibleIds, unit.id);
      const hasChildren = kids.length > 0;
      const open = !collapsed[unit.id];
      const guides: GuideKind[] = ancestorContinues.map((continues, level) =>
        level < depth - 1
          ? continues
            ? "bar"
            : "blank"
          : isLast
            ? "elbow"
            : "tee",
      );
      rows.push({
        unit,
        depth,
        guides,
        hasChildren,
        open,
        isRoot: depth === 0,
        isFirst: false,
      });
      if (hasChildren && open) walk(kids, [...ancestorContinues, !isLast]);
    });
  };

  walk(childrenOf(units, visibleIds, null), []);
  if (rows.length > 0) rows[0]!.isFirst = true;
  return rows;
}

/** Every unit with at least one visible child — drives the expand/collapse-all toggle. */
export function collapsibleUnitIds(units: OrgUnitResponse[]): string[] {
  const visibleIds = new Set(units.map((u) => u.id));
  return units
    .filter((u) => childrenOf(units, visibleIds, u.id).length > 0)
    .map((u) => u.id);
}

/**
 * The unit's own contiguous visible-ancestor chain, root-first, ending with
 * the unit itself — the SAME parent-child edges `buildRows` used to nest
 * it, so a unit rendered as a tree root (invisible immediate parent) also
 * breadcrumbs/effective-role-walks as just itself, not a phantom path
 * through ancestors the caller can't see.
 */
export function visibleAncestorChain(
  unit: OrgUnitResponse,
  unitsById: Map<string, OrgUnitResponse>,
): OrgUnitResponse[] {
  const chain: OrgUnitResponse[] = [];
  const visited = new Set<string>();
  let current: OrgUnitResponse | undefined = unit;
  while (current && !visited.has(current.id)) {
    chain.unshift(current);
    visited.add(current.id);
    current = current.parentId ? unitsById.get(current.parentId) : undefined;
  }
  return chain;
}

export type EffectiveRole = {
  role: OrgRole;
  via: OrgUnitResponse;
  inherited: boolean;
};

/**
 * Nearest-ancestor-wins effective role, walked client-side from the unit
 * itself back to the root of its visible chain (D2/D3 — no per-node server
 * call). Any ancestor holding a `directRole` for the caller is necessarily
 * visible to them too (a role on a unit trivially satisfies the
 * `org_units_select` "role on path" check for that unit's own path), so
 * skipping past a directRole-less/invisible ancestor here can never miss a
 * real inherited role.
 */
export function effectiveRoleFor(
  unit: OrgUnitResponse,
  unitsById: Map<string, OrgUnitResponse>,
): EffectiveRole | null {
  const chain = visibleAncestorChain(unit, unitsById);
  for (let i = chain.length - 1; i >= 0; i--) {
    const candidate = chain[i]!;
    if (candidate.directRole) {
      return {
        role: candidate.directRole,
        via: candidate,
        inherited: candidate.id !== unit.id,
      };
    }
  }
  return null;
}

/**
 * Every descendant of `unitId` among the visible `units`, by true
 * (server) `parentId` edges — NOT the tree-rendering "effective parent"
 * heuristic above. Move-target exclusion needs the real ancestry: a
 * candidate must be excluded if it's really nested under the unit being
 * moved, even in the (same edge case as above) situation where some
 * intermediate link isn't renderable as a contiguous tree edge.
 */
export function descendantIdsOf(
  unitId: string,
  units: OrgUnitResponse[],
): Set<string> {
  const childrenByParent = new Map<string, OrgUnitResponse[]>();
  for (const u of units) {
    if (!u.parentId) continue;
    const list = childrenByParent.get(u.parentId) ?? [];
    list.push(u);
    childrenByParent.set(u.parentId, list);
  }
  const out = new Set<string>();
  const stack = [unitId];
  while (stack.length > 0) {
    const id = stack.pop()!;
    for (const child of childrenByParent.get(id) ?? []) {
      if (!out.has(child.id)) {
        out.add(child.id);
        stack.push(child.id);
      }
    }
  }
  return out;
}
