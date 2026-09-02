// @vitest-environment jsdom

/**
 * DOM-level coverage for the create/rename/move dialogs: form state, submit
 * validation (blank/unchanged name skip the mutation and just close), and the
 * actual request each real mutation hook sends against a stubbed
 * globalThis.fetch. Delete/DeleteBlocked are exercised end-to-end through the
 * tree in org-tree.test.tsx; not duplicated here.
 */

import type { ReactElement } from "react";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import type { Mock } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import type { OrgUnitResponse } from "@/lib/services/org-units/types";
import {
  emptyResponse,
  jsonResponse,
  requestFromCall,
  stubFetch,
} from "@/lib/test-support/fetch-stub";

import {
  CreateOrgUnitDialog,
  MoveOrgUnitDialog,
  RenameOrgUnitDialog,
} from "./org-unit-dialogs";

let fetchMock: Mock<typeof fetch>;
let queryClient: QueryClient;

function unit(
  overrides: Partial<OrgUnitResponse> & { id: string; name: string },
): OrgUnitResponse {
  return {
    parentId: null,
    type: "organization",
    path: overrides.id,
    settings: {},
    createdAt: "2026-01-01T00:00:00.000Z",
    memberCount: 1,
    directRole: null,
    ...overrides,
  };
}

const acme = unit({ id: "org1", name: "Acme", type: "organization" });
const teamA = unit({
  id: "teamA",
  name: "Team A",
  parentId: "org1",
  type: "team",
});

function isDisabledButton(name: string): boolean {
  // SAFETY: resolved via getByRole("button", ...), always an HTMLButtonElement.
  return (screen.getByRole("button", { name }) as HTMLButtonElement).disabled;
}

function renderWithClient(node: ReactElement) {
  return render(
    <QueryClientProvider client={queryClient}>{node}</QueryClientProvider>,
  );
}

beforeAll(() => {
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

beforeEach(() => {
  fetchMock = stubFetch();
  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("CreateOrgUnitDialog — root", () => {
  it("disables Create until a name is entered, then POSTs /org-units and closes on success", async () => {
    fetchMock.mockResolvedValue(jsonResponse(acme));
    const onOpenChange = vi.fn();
    renderWithClient(<CreateOrgUnitDialog open onOpenChange={onOpenChange} />);

    expect(isDisabledButton("Create")).toBe(true);

    fireEvent.change(screen.getByLabelText("Name"), {
      target: { value: "New Co" },
    });
    expect(isDisabledButton("Create")).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: "Create" }));

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    const request = requestFromCall(fetchMock);
    expect(request.method).toBe("POST");
    expect(new URL(request.url).pathname).toBe("/api/v1/org-units");
    await expect(request.clone().json()).resolves.toEqual({ name: "New Co" });
  });

  it("submits on Enter in the name field, trimming surrounding whitespace", async () => {
    fetchMock.mockResolvedValue(jsonResponse(acme));
    renderWithClient(<CreateOrgUnitDialog open onOpenChange={vi.fn()} />);

    const field = screen.getByLabelText("Name");
    fireEvent.change(field, { target: { value: "  Spaced Co  " } });
    fireEvent.keyDown(field, { key: "Enter" });

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const request = requestFromCall(fetchMock);
    await expect(request.clone().json()).resolves.toEqual({
      name: "Spaced Co",
    });
  });

  it("Enter on a blank/whitespace-only name does not submit", () => {
    renderWithClient(<CreateOrgUnitDialog open onOpenChange={vi.fn()} />);

    const field = screen.getByLabelText("Name");
    fireEvent.change(field, { target: { value: "   " } });
    fireEvent.keyDown(field, { key: "Enter" });

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("Cancel closes without submitting", () => {
    const onOpenChange = vi.fn();
    renderWithClient(<CreateOrgUnitDialog open onOpenChange={onOpenChange} />);

    fireEvent.change(screen.getByLabelText("Name"), {
      target: { value: "New Co" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("CreateOrgUnitDialog — child", () => {
  it("shows the type picker and POSTs to the parent's children with the chosen type", async () => {
    fetchMock.mockResolvedValue(jsonResponse(teamA));
    renderWithClient(
      <CreateOrgUnitDialog parent={acme} open onOpenChange={vi.fn()} />,
    );

    expect(
      screen.getByRole("heading", { name: "New unit under “Acme”" }),
    ).toBeTruthy();

    fireEvent.change(screen.getByLabelText("Name"), {
      target: { value: "Design" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Department" }));
    fireEvent.click(screen.getByRole("button", { name: "Create" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const request = requestFromCall(fetchMock);
    expect(new URL(request.url).pathname).toBe(
      "/api/v1/org-units/org1/children",
    );
    await expect(request.clone().json()).resolves.toEqual({
      name: "Design",
      type: "department",
    });
  });
});

describe("RenameOrgUnitDialog", () => {
  it("Save with an unchanged name closes without sending a mutation", () => {
    const onOpenChange = vi.fn();
    renderWithClient(
      <RenameOrgUnitDialog unit={teamA} open onOpenChange={onOpenChange} />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("Save with a changed name PATCHes the unit and closes on success", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ ...teamA, name: "Team Alpha" }));
    const onOpenChange = vi.fn();
    renderWithClient(
      <RenameOrgUnitDialog unit={teamA} open onOpenChange={onOpenChange} />,
    );

    fireEvent.change(screen.getByLabelText("Name"), {
      target: { value: "Team Alpha" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    const request = requestFromCall(fetchMock);
    expect(request.method).toBe("PATCH");
    expect(new URL(request.url).pathname).toBe("/api/v1/org-units/teamA");
    await expect(request.clone().json()).resolves.toEqual({
      name: "Team Alpha",
    });
  });

  it("submits on Enter in the name field", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ ...teamA, name: "Team Alpha" }));
    renderWithClient(
      <RenameOrgUnitDialog unit={teamA} open onOpenChange={vi.fn()} />,
    );

    const field = screen.getByLabelText("Name");
    fireEvent.change(field, { target: { value: "Team Alpha" } });
    fireEvent.keyDown(field, { key: "Enter" });

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
  });

  it("Cancel closes without submitting", () => {
    const onOpenChange = vi.fn();
    renderWithClient(
      <RenameOrgUnitDialog unit={teamA} open onOpenChange={onOpenChange} />,
    );

    fireEvent.change(screen.getByLabelText("Name"), {
      target: { value: "Something else" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("MoveOrgUnitDialog", () => {
  it("Move disabled while the picked parent is unchanged; picking a different one enables it and PATCHes on submit", async () => {
    fetchMock.mockResolvedValue(emptyResponse());
    const onOpenChange = vi.fn();
    const units = [acme, teamA];
    renderWithClient(
      <MoveOrgUnitDialog
        unit={teamA}
        units={units}
        open
        onOpenChange={onOpenChange}
      />,
    );

    expect(isDisabledButton("Move")).toBe(true);

    fireEvent.click(screen.getByText("— Make root organization —"));
    expect(isDisabledButton("Move")).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: "Move" }));

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    const request = requestFromCall(fetchMock);
    expect(request.method).toBe("PATCH");
    expect(new URL(request.url).pathname).toBe("/api/v1/org-units/teamA");
    await expect(request.clone().json()).resolves.toEqual({ parentId: null });
  });

  it("Cancel closes without submitting", () => {
    const onOpenChange = vi.fn();
    renderWithClient(
      <MoveOrgUnitDialog
        unit={teamA}
        units={[acme, teamA]}
        open
        onOpenChange={onOpenChange}
      />,
    );

    fireEvent.click(screen.getByText("— Make root organization —"));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
