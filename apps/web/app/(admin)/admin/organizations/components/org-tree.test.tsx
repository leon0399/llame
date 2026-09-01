// @vitest-environment jsdom

/**
 * DOM-level coverage for the tree redesign (admin-area-org-tree change,
 * tasks.md section 3–4): chevron collapse, the direct-role badge vs. the
 * always-shown member count, the leaf-first delete pre-check (explainer vs.
 * confirmation — no mutation on the blocked path), the move picker's
 * self+descendant exclusion and "make root" option, and the selected-unit
 * footer's direct/inherited/none effective-role text. Pure guide-algorithm
 * assertions live in org-tree-utils.test.ts.
 */

import * as React from "react";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";

import type { OrgUnitResponse } from "@/lib/services/org-units/types";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Mock } from "vitest";
import {
  emptyResponse,
  requestFromCall,
  stubFetch,
} from "@/lib/test-support/fetch-stub";

// No hook mocking: the real mutation hooks run against a stubbed
// globalThis.fetch, so a delete that reaches the network is proved by the
// request it sends rather than by a spy the test wired up itself.
let fetchMock: Mock<typeof fetch>;
let queryClient: QueryClient;

function renderTree(units: Array<OrgUnitResponse>) {
  return render(
    <QueryClientProvider client={queryClient}>
      <OrgUnitsTree units={units} />
    </QueryClientProvider>,
  );
}

import { OrgUnitsTree } from "./org-tree";

beforeEach(() => {
  fetchMock = stubFetch();
  fetchMock.mockResolvedValue(emptyResponse());
  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
});

beforeAll(() => {
  // jsdom doesn't implement the Pointer Events capture API Base UI's
  // Dialog/AlertDialog rely on for focus handling.
  for (const method of [
    "hasPointerCapture",
    "setPointerCapture",
    "releasePointerCapture",
  ] as const) {
    if (!(method in Element.prototype)) {
      Object.defineProperty(Element.prototype, method, {
        value: () => false,
        writable: true,
      });
    }
  }
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function unit(
  overrides: Partial<OrgUnitResponse> & { id: string; name: string },
): OrgUnitResponse {
  return {
    parentId: null,
    type: "organization",
    path: overrides.id,
    settings: {},
    createdAt: "2026-01-01T00:00:00.000Z",
    memberCount: 0,
    directRole: null,
    ...overrides,
  };
}

// Acme (owner, direct)
// ├─ Team A (leaf, no role)
// └─ Dept B (has child -> Team C)
//    └─ Team C (leaf, inherits owner from Acme)
// Home Lab (leaf root, no role anywhere)
const acme = unit({
  id: "org1",
  name: "Acme",
  type: "organization",
  path: "org1",
  directRole: "owner",
  memberCount: 5,
});
const teamA = unit({
  id: "teamA",
  name: "Team A",
  parentId: "org1",
  type: "team",
  path: "org1/teamA",
  memberCount: 2,
});
const deptB = unit({
  id: "deptB",
  name: "Dept B",
  parentId: "org1",
  type: "department",
  path: "org1/deptB",
  memberCount: 4,
});
const teamC = unit({
  id: "teamC",
  name: "Team C",
  parentId: "deptB",
  type: "team",
  path: "org1/deptB/teamC",
  memberCount: 1,
});
const homeLab = unit({
  id: "org2",
  name: "Home Lab",
  type: "organization",
  path: "org2",
});
const fixtureUnits = [acme, teamA, deptB, teamC, homeLab];

describe("OrgUnitsTree — rows", () => {
  it("renders every unit as a treeitem with role badge only where a direct role exists", () => {
    renderTree(fixtureUnits);

    const acmeRow = screen.getByTestId("org-unit-row-org1");
    expect(within(acmeRow).getByText("owner")).toBeTruthy();
    expect(within(acmeRow).getByText("5")).toBeTruthy();

    const teamARow = screen.getByTestId("org-unit-row-teamA");
    expect(
      within(teamARow).queryByText(/owner|admin|member|viewer|guest/i),
    ).toBeNull();
    expect(within(teamARow).getByText("2")).toBeTruthy();
  });

  it("collapsing a node with children hides its subtree; expanding restores it", () => {
    renderTree(fixtureUnits);

    expect(screen.getByTestId("org-unit-row-teamC")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Collapse Dept B" }));
    expect(screen.queryByTestId("org-unit-row-teamC")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Expand Dept B" }));
    expect(screen.getByTestId("org-unit-row-teamC")).toBeTruthy();
  });

  it("Enter selects the focused ROW but never hijacks a child button's keydown", () => {
    renderTree(fixtureUnits);

    // Row itself focused: Enter selects it (footer breadcrumb follows).
    const teamARow = screen.getByTestId("org-unit-row-teamA");
    fireEvent.keyDown(teamARow, { key: "Enter" });
    expect(screen.getByText(/Acme\s+›\s+Team A/)).toBeTruthy();

    // A child button focused: the bubbled Enter must NOT be preventDefault'd
    // into a row-select — the event's default (button activation) survives.
    const collapse = screen.getByRole("button", { name: "Collapse Dept B" });
    const notPrevented = fireEvent.keyDown(collapse, { key: "Enter" });
    expect(notPrevented).toBe(true); // preventDefault was NOT called
    // And the row selection did not jump to Dept B.
    expect(screen.getByText(/Acme\s+›\s+Team A/)).toBeTruthy();
  });
});

describe("OrgUnitsTree — leaf-first delete", () => {
  it("clicking delete on a non-leaf opens the explainer and sends no mutation", () => {
    renderTree(fixtureUnits);

    fireEvent.click(screen.getByRole("button", { name: "Delete Dept B" }));

    expect(
      screen.getByRole("heading", { name: "Can’t delete “Dept B”" }),
    ).toBeTruthy();
    expect(screen.getByText(/deleted leaf-first/i)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Delete" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Got it" }));
    // The blocked path must not reach the network at all.
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("clicking delete on a leaf opens a named confirmation and sends the mutation on confirm", async () => {
    renderTree(fixtureUnits);

    fireEvent.click(screen.getByRole("button", { name: "Delete Team A" }));

    expect(
      screen.getByRole("heading", { name: "Delete “Team A”?" }),
    ).toBeTruthy();
    expect(screen.getByText(/removes every membership/i)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    // The mutation dispatches asynchronously; wait for the request itself
    // rather than for a spy that was never the thing under test.
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const request = requestFromCall(fetchMock);
    expect(request.method).toBe("DELETE");
    expect(new URL(request.url).pathname).toBe("/api/v1/org-units/teamA");
  });
});

describe("OrgUnitsTree — toolbar", () => {
  it("Collapse all / Expand all toggles every collapsible row at once", () => {
    renderTree(fixtureUnits);

    expect(screen.getByTestId("org-unit-row-teamC")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Collapse all" }));
    expect(screen.queryByTestId("org-unit-row-teamA")).toBeNull();
    expect(screen.queryByTestId("org-unit-row-teamC")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Expand all" }));
    expect(screen.getByTestId("org-unit-row-teamA")).toBeTruthy();
    expect(screen.getByTestId("org-unit-row-teamC")).toBeTruthy();
  });
});

describe("OrgUnitsTree — add child / rename", () => {
  it("Add child opens the create dialog scoped to that parent and expands its row", () => {
    renderTree(fixtureUnits);

    fireEvent.click(screen.getByRole("button", { name: "Collapse Dept B" }));
    expect(screen.queryByTestId("org-unit-row-teamC")).toBeNull();

    fireEvent.click(
      screen.getByRole("button", { name: "Add child unit to Dept B" }),
    );

    expect(
      screen.getByRole("heading", { name: "New unit under “Dept B”" }),
    ).toBeTruthy();
    // The parent row is expanded so the unit the dialog will create is
    // visible once it lands, rather than hidden behind a collapsed chevron.
    expect(screen.getByTestId("org-unit-row-teamC")).toBeTruthy();
  });

  it("Rename opens the rename dialog for that unit", () => {
    renderTree(fixtureUnits);

    fireEvent.click(screen.getByRole("button", { name: "Rename Team A" }));

    expect(
      screen.getByRole("heading", { name: "Rename “Team A”" }),
    ).toBeTruthy();
  });
});

describe("OrgUnitsTree — move picker", () => {
  it("excludes the unit and its descendants, offers make-root, keeps unrelated units", () => {
    renderTree(fixtureUnits);

    fireEvent.click(screen.getByRole("button", { name: "Move Dept B" }));

    const listbox = screen.getByRole("listbox", { name: "New parent" });
    expect(
      within(listbox).getByText("— Make root organization —"),
    ).toBeTruthy();
    expect(within(listbox).getByText("Team A")).toBeTruthy();
    expect(within(listbox).getByText("Home Lab")).toBeTruthy();
    // Self and its descendant must be absent.
    expect(within(listbox).queryByText("Dept B")).toBeNull();
    expect(within(listbox).queryByText("Team C")).toBeNull();
  });
});

describe("OrgUnitsTree — selected-unit footer", () => {
  it("shows the direct role for a unit with its own membership", () => {
    renderTree(fixtureUnits);
    fireEvent.click(screen.getByTestId("org-unit-row-org1"));
    expect(screen.getByText("Your role here: owner · direct")).toBeTruthy();
  });

  it("shows the inherited role and its source for a unit with no direct role", () => {
    renderTree(fixtureUnits);
    fireEvent.click(screen.getByTestId("org-unit-row-teamC"));
    expect(
      screen.getByText("Your role here: owner · inherited from Acme"),
    ).toBeTruthy();
  });

  it("shows the no-role copy when neither the unit nor any ancestor has a role", () => {
    renderTree(fixtureUnits);
    fireEvent.click(screen.getByTestId("org-unit-row-org2"));
    expect(
      screen.getByText("You have no direct role on this unit."),
    ).toBeTruthy();
  });

  it("renders the Manage members button disabled", () => {
    renderTree(fixtureUnits);
    fireEvent.click(screen.getByTestId("org-unit-row-org1"));
    // SAFETY: queried by role "button", so the element is a real <button>.
    const button = screen.getByRole("button", {
      name: /manage members/i,
    }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
  });
});

describe("OrgUnitsTree — empty state", () => {
  it("shows the first-run empty state when there are no units", () => {
    renderTree([]);
    expect(screen.getByText("No organizations yet")).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Create organization" }),
    ).toBeTruthy();
  });
});
