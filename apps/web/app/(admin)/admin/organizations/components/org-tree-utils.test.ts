/**
 * Pure-logic coverage for the tree algorithm (admin-area-org-tree change,
 * task 3.1/3.2): guide-column computation, expand/collapse-all
 * eligibility, the client-side effective-role walk, and move-target
 * descendant exclusion. DOM-level behavior (chevron clicks, dialogs) is
 * covered separately in org-tree.test.tsx.
 */

import { describe, expect, it } from "vitest";

import type { OrgUnitResponse } from "@/lib/services/org-units/types";

import {
  buildRows,
  collapsibleUnitIds,
  descendantIdsOf,
  effectiveRoleFor,
  visibleAncestorChain,
} from "./org-tree-utils";

function unit(
  overrides: Partial<OrgUnitResponse> & { id: string },
): OrgUnitResponse {
  return {
    parentId: null,
    name: overrides.id,
    type: "organization",
    path: overrides.id,
    settings: {},
    createdAt: "2026-01-01T00:00:00.000Z",
    memberCount: 0,
    directRole: null,
    ...overrides,
  };
}

// org1
// ├─ teamA (leaf)
// └─ deptB
//    └─ teamC (leaf)
// org2 (leaf)
const org1 = unit({
  id: "org1",
  type: "organization",
  path: "org1",
  directRole: "owner",
});
const teamA = unit({
  id: "teamA",
  parentId: "org1",
  type: "team",
  path: "org1/teamA",
});
const deptB = unit({
  id: "deptB",
  parentId: "org1",
  type: "department",
  path: "org1/deptB",
});
const teamC = unit({
  id: "teamC",
  parentId: "deptB",
  type: "team",
  path: "org1/deptB/teamC",
});
const org2 = unit({ id: "org2", type: "organization", path: "org2" });
const units = [org1, teamA, deptB, teamC, org2];

describe("buildRows", () => {
  it("orders rows depth-first and marks depth/root/hasChildren correctly", () => {
    const rows = buildRows(units, {});
    expect(rows.map((r) => r.unit.id)).toEqual([
      "org1",
      "teamA",
      "deptB",
      "teamC",
      "org2",
    ]);
    expect(rows.map((r) => r.depth)).toEqual([0, 1, 1, 2, 0]);
    expect(rows.map((r) => r.isRoot)).toEqual([
      true,
      false,
      false,
      false,
      true,
    ]);
    expect(rows.find((r) => r.unit.id === "org1")?.hasChildren).toBe(true);
    expect(rows.find((r) => r.unit.id === "teamA")?.hasChildren).toBe(false);
    expect(rows.find((r) => r.unit.id === "deptB")?.hasChildren).toBe(true);
  });

  it("marks only the very first row as `isFirst`", () => {
    const rows = buildRows(units, {});
    expect(rows[0]!.isFirst).toBe(true);
    expect(rows.slice(1).every((r) => !r.isFirst)).toBe(true);
  });

  it("computes tee/elbow guides by sibling position, bar/blank by ancestor continuation", () => {
    const rows = buildRows(units, {});
    const teamARow = rows.find((r) => r.unit.id === "teamA")!;
    const deptBRow = rows.find((r) => r.unit.id === "deptB")!;
    const teamCRow = rows.find((r) => r.unit.id === "teamC")!;

    // teamA is org1's first child, NOT last (deptB follows) -> tee.
    expect(teamARow.guides).toEqual(["tee"]);
    // deptB is org1's last child -> elbow.
    expect(deptBRow.guides).toEqual(["elbow"]);
    // teamC's column 0 reflects org1 (the root ancestor at that depth):
    // org1 itself has a following sibling (org2), so the vertical guide
    // continues ("bar") through org1's WHOLE subtree, all the way down to
    // where org2 appears. Column 1 (teamC's own, immediate-parent column)
    // is elbow/tee based on teamC's own sibling position under deptB —
    // teamC is deptB's only/last child -> elbow.
    expect(teamCRow.guides).toEqual(["bar", "elbow"]);
  });

  it("collapsing a node hides its subtree but keeps its own row", () => {
    const rows = buildRows(units, { deptB: true });
    expect(rows.map((r) => r.unit.id)).toEqual([
      "org1",
      "teamA",
      "deptB",
      "org2",
    ]);
    expect(rows.find((r) => r.unit.id === "deptB")?.open).toBe(false);
  });

  it("treats a unit whose real parent isn't in the visible list as a tree root", () => {
    // teamC visible without its parent deptB (RLS: role on teamC itself,
    // nothing higher) — must render as its own root, not nested under
    // nothing.
    const rows = buildRows([org1, teamC], {});
    expect(rows.map((r) => r.unit.id)).toEqual(["org1", "teamC"]);
    expect(rows.find((r) => r.unit.id === "teamC")?.depth).toBe(0);
    expect(rows.find((r) => r.unit.id === "teamC")?.isRoot).toBe(true);
  });
});

describe("collapsibleUnitIds", () => {
  it("returns only units with at least one visible child", () => {
    expect(collapsibleUnitIds(units).sort()).toEqual(["deptB", "org1"]);
  });
});

describe("visibleAncestorChain", () => {
  it("returns root-first chain ending with the unit itself", () => {
    const unitsById = new Map(units.map((u) => [u.id, u]));
    expect(visibleAncestorChain(teamC, unitsById).map((u) => u.id)).toEqual([
      "org1",
      "deptB",
      "teamC",
    ]);
  });

  it("stops at the first invisible ancestor — the unit becomes its own chain root", () => {
    const unitsById = new Map([org1, teamC].map((u) => [u.id, u]));
    expect(visibleAncestorChain(teamC, unitsById).map((u) => u.id)).toEqual([
      "teamC",
    ]);
  });
});

describe("effectiveRoleFor", () => {
  const unitsById = new Map(units.map((u) => [u.id, u]));

  it("returns the unit's own directRole, not inherited, when it has one", () => {
    const result = effectiveRoleFor(org1, unitsById);
    expect(result).toEqual({ role: "owner", via: org1, inherited: false });
  });

  it("walks up to the nearest ancestor with a directRole, marked inherited", () => {
    const result = effectiveRoleFor(teamC, unitsById);
    expect(result?.role).toBe("owner");
    expect(result?.via.id).toBe("org1");
    expect(result?.inherited).toBe(true);
  });

  it("returns null when neither the unit nor any visible ancestor has a role", () => {
    expect(effectiveRoleFor(org2, unitsById)).toBeNull();
  });
});

describe("descendantIdsOf", () => {
  it("returns every true descendant, not just direct children", () => {
    expect([...descendantIdsOf("org1", units)].sort()).toEqual([
      "deptB",
      "teamA",
      "teamC",
    ]);
  });

  it("returns an empty set for a leaf", () => {
    expect(descendantIdsOf("teamC", units).size).toBe(0);
  });
});
