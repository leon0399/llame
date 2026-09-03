// @vitest-environment jsdom

/**
 * Coverage for the parked-but-still-API-complete Members panel (see the
 * file's own PARKED header comment: unwired today, kept for a fast-follow
 * re-wire). Real hooks run against a stubbed globalThis.fetch — no
 * first-party module mocking. The role-change and grant-role pickers
 * (RolePicker's DropdownMenu) are DOM-render/interaction surface that
 * belongs in Storybook per docs/testing.md rule 5, so those two branches
 * (`role === "owner"` in the grant form and row role-change) are exercised
 * directly against their own exported confirm-dialog components instead of
 * by driving the floating-menu picker from here.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import type { Mock } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import {
  jsonResponse,
  requestFromCall,
  stubFetch,
} from "@/lib/test-support/fetch-stub";
import type {
  MembershipResponse,
  OrgUnitResponse,
} from "@/lib/services/org-units/types";

import {
  useChangeMembershipRole,
  useRevokeMembership,
} from "@/lib/services/org-units/mutations";

import { MembersPanel } from "./members-panel";
import {
  ConfirmOwnerGrantDialog,
  MembershipRowDialogs,
} from "./member-confirm-dialogs";

let fetchMock: Mock<typeof fetch>;
let queryClient: QueryClient;

function unit(overrides: Partial<OrgUnitResponse> & { id: string }) {
  const base: OrgUnitResponse = {
    id: overrides.id,
    name: "Acme",
    parentId: null,
    type: "organization",
    path: overrides.id,
    settings: {},
    createdAt: "2026-01-01T00:00:00.000Z",
    memberCount: 1,
    directRole: null,
  };
  return { ...base, ...overrides };
}

function membership(
  overrides: Partial<MembershipResponse> & { userId: string },
): MembershipResponse {
  return {
    id: `m-${overrides.userId}`,
    orgUnitId: "u1",
    role: "member",
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

/** Index of the most recent call whose Request used `method` — several
 * assertions below fire after a mutation's onSuccess has already kicked off
 * cache-invalidation refetches, so "the last call" isn't reliably the
 * mutation's own request. */
function lastCallIndex(mock: Mock<typeof fetch>, method: string): number {
  for (let i = mock.mock.calls.length - 1; i >= 0; i--) {
    const request = mock.mock.calls[i]?.[0];
    if (request instanceof Request && request.method === method) return i;
  }
  throw new Error(`no ${method} call recorded`);
}

function routeFetch(
  handlers: Record<string, (request: Request) => Response | Promise<Response>>,
) {
  fetchMock = stubFetch();
  fetchMock.mockImplementation(async (input) => {
    const request = input instanceof Request ? input : new Request(input);
    const { pathname } = new URL(request.url);
    const key = `${request.method} ${pathname}`;
    const handler = handlers[key];
    if (!handler) {
      throw new Error(`unrouted fetch in test: ${key}`);
    }
    return handler(request);
  });
}

function renderPanel(
  orgUnitId: string,
  units: Array<OrgUnitResponse>,
  handlers: Record<string, (request: Request) => Response | Promise<Response>>,
) {
  routeFetch({
    "GET /auth/v1/me": () =>
      jsonResponse({
        id: "me-1",
        name: "Leo",
        email: "leo@example.com",
        emailVerified: null,
        image: null,
      }),
    ...handlers,
  });
  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <MembersPanel orgUnitId={orgUnitId} units={units} />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  cleanup();
});

describe("MembersPanel", () => {
  it("shows loading copy for the roster and my-role description before data resolves", () => {
    renderPanel("u1", [unit({ id: "u1", name: "Acme" })], {
      "GET /api/v1/org-units/u1/memberships": () =>
        new Promise(() => {
          // never resolves — asserts the loading branch only.
        }),
      "GET /api/v1/org-units/u1/memberships/me": () => new Promise(() => {}),
    });

    expect(screen.getByText("Loading roster…")).toBeTruthy();
    expect(screen.getByText("Loading your role…")).toBeTruthy();
  });

  it("shows the empty-roster message when no memberships come back", async () => {
    renderPanel("u1", [unit({ id: "u1", name: "Acme" })], {
      "GET /api/v1/org-units/u1/memberships": () => jsonResponse([]),
      "GET /api/v1/org-units/u1/memberships/me": () =>
        jsonResponse({ message: "not found" }, 404),
    });

    await waitFor(() =>
      expect(screen.getByText("No members visible here yet.")).toBeTruthy(),
    );
    expect(screen.getByText("You have no role on this unit.")).toBeTruthy();
  });

  it("renders the roster, marks the caller as (you), and disables the role control for a service_account", async () => {
    renderPanel("u1", [unit({ id: "u1", name: "Acme" })], {
      "GET /api/v1/org-units/u1/memberships": () =>
        jsonResponse([
          membership({ userId: "me-1", role: "owner" }),
          membership({ userId: "svc-1", role: "service_account" }),
        ]),
      "GET /api/v1/org-units/u1/memberships/me": () =>
        jsonResponse({ role: "owner", viaOrgUnitId: "u1", inherited: false }),
    });

    await waitFor(() =>
      expect(screen.getByTestId("membership-row-me-1")).toBeTruthy(),
    );
    expect(screen.getByTestId("membership-row-me-1").textContent).toContain(
      "(you)",
    );
    expect(screen.getByText("Your role here: Owner")).toBeTruthy();

    const svcRow = screen.getByTestId("membership-row-svc-1");
    const svcRoleButton = svcRow.querySelector("button[disabled]");
    expect(svcRoleButton?.textContent).toBe("Service account");
  });

  it("describes an inherited role via the ancestor unit's name", async () => {
    renderPanel(
      "u2",
      [
        unit({ id: "u1", name: "Acme" }),
        unit({ id: "u2", name: "Acme / Eng" }),
      ],
      {
        "GET /api/v1/org-units/u2/memberships": () => jsonResponse([]),
        "GET /api/v1/org-units/u2/memberships/me": () =>
          jsonResponse({ role: "admin", viaOrgUnitId: "u1", inherited: true }),
      },
    );

    await waitFor(() =>
      expect(
        screen.getByText("Your role here: Admin (inherited from Acme)"),
      ).toBeTruthy(),
    );
  });

  it("grants a membership at the default role and clears the field on success", async () => {
    renderPanel("u1", [unit({ id: "u1", name: "Acme" })], {
      "GET /api/v1/org-units/u1/memberships": () => jsonResponse([]),
      "GET /api/v1/org-units/u1/memberships/me": () =>
        jsonResponse({ message: "not found" }, 404),
      "POST /api/v1/org-units/u1/memberships": () => jsonResponse(null),
    });

    await waitFor(() =>
      expect(screen.getByText("No members visible here yet.")).toBeTruthy(),
    );

    // SAFETY: the "User ID" label is on the Input's own <input>, so this
    // query always resolves to an HTMLInputElement.
    const input = screen.getByLabelText("User ID") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "new-user" } });
    fireEvent.click(screen.getByRole("button", { name: "Grant" }));

    await waitFor(() => expect(input.value).toBe(""));

    const request = requestFromCall(
      fetchMock,
      lastCallIndex(fetchMock, "POST"),
    );
    expect(new URL(request.url).pathname).toBe(
      "/api/v1/org-units/u1/memberships",
    );
    expect(await request.clone().json()).toEqual({
      userId: "new-user",
      role: "member",
    });
  });

  it("does not submit the grant when the user id is blank", async () => {
    renderPanel("u1", [unit({ id: "u1", name: "Acme" })], {
      "GET /api/v1/org-units/u1/memberships": () => jsonResponse([]),
      "GET /api/v1/org-units/u1/memberships/me": () =>
        jsonResponse({ message: "not found" }, 404),
    });

    await waitFor(() =>
      expect(screen.getByText("No members visible here yet.")).toBeTruthy(),
    );

    expect(screen.getByRole("button", { name: "Grant" })).toHaveProperty(
      "disabled",
      true,
    );
  });

  it("revokes another member on confirm, wording the dialog as Revoke", async () => {
    let revokeCalled = false;
    renderPanel("u1", [unit({ id: "u1", name: "Acme" })], {
      "GET /api/v1/org-units/u1/memberships": () =>
        jsonResponse([membership({ userId: "other-1", role: "member" })]),
      "GET /api/v1/org-units/u1/memberships/me": () =>
        jsonResponse({ role: "owner", viaOrgUnitId: "u1", inherited: false }),
      "DELETE /api/v1/org-units/u1/memberships/other-1": () => {
        revokeCalled = true;
        return jsonResponse(null);
      },
    });

    await waitFor(() =>
      expect(screen.getByTestId("membership-row-other-1")).toBeTruthy(),
    );

    fireEvent.click(screen.getByRole("button", { name: "Revoke" }));
    expect(screen.getByText("Revoke other-1?")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Revoke" }));

    await waitFor(() => expect(revokeCalled).toBe(true));
  });

  it("leaves the unit on confirm when revoking the caller's own membership, wording it as Leave", async () => {
    renderPanel("u1", [unit({ id: "u1", name: "Acme" })], {
      "GET /api/v1/org-units/u1/memberships": () =>
        jsonResponse([membership({ userId: "me-1", role: "admin" })]),
      "GET /api/v1/org-units/u1/memberships/me": () =>
        jsonResponse({ role: "admin", viaOrgUnitId: "u1", inherited: false }),
      "DELETE /api/v1/org-units/u1/memberships/me-1": () => jsonResponse(null),
    });

    await waitFor(() =>
      expect(screen.getByTestId("membership-row-me-1")).toBeTruthy(),
    );

    fireEvent.click(screen.getByRole("button", { name: "Leave" }));
    expect(screen.getByText("Leave this unit?")).toBeTruthy();
    expect(
      screen.getByText(
        "You’ll lose your role and access here. An admin or owner can re-add you later.",
      ),
    ).toBeTruthy();
  });

  it("shows the classified error inline and keeps the revoke dialog open on failure", async () => {
    renderPanel("u1", [unit({ id: "u1", name: "Acme" })], {
      "GET /api/v1/org-units/u1/memberships": () =>
        jsonResponse([membership({ userId: "me-1", role: "owner" })]),
      "GET /api/v1/org-units/u1/memberships/me": () =>
        jsonResponse({ role: "owner", viaOrgUnitId: "u1", inherited: false }),
      "DELETE /api/v1/org-units/u1/memberships/me-1": () =>
        jsonResponse({ code: "LAST_OWNER" }, 409),
    });

    await waitFor(() =>
      expect(screen.getByTestId("membership-row-me-1")).toBeTruthy(),
    );

    fireEvent.click(screen.getByRole("button", { name: "Leave" }));
    fireEvent.click(screen.getByRole("button", { name: "Leave" }));

    await waitFor(() =>
      expect(
        screen.getByText(
          "You’re the last owner here — transfer ownership first. Use the role control next to another member to make them owner, then try again.",
        ),
      ).toBeTruthy(),
    );
    // Still open — the dialog title from the failed attempt is still present.
    expect(screen.getByText("Leave this unit?")).toBeTruthy();
  });
});

describe("ConfirmOwnerGrantDialog", () => {
  it("names the grantee and sends Grant ownership on confirm", () => {
    const onConfirm = vi.fn();
    render(
      <ConfirmOwnerGrantDialog
        open
        onOpenChange={() => {}}
        userId="new-owner"
        onConfirm={onConfirm}
      />,
    );

    expect(screen.getByText("Grant ownership?")).toBeTruthy();
    expect(screen.getByText(/“new-owner”/)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Grant ownership" }));
    expect(onConfirm).toHaveBeenCalledOnce();
  });
});

describe("MembershipRowDialogs — owner role-change branch", () => {
  it("PATCHes role=owner on confirm and closes the dialog on success", async () => {
    fetchMock = stubFetch();
    fetchMock.mockResolvedValue(
      jsonResponse(membership({ userId: "target-1", role: "owner" })),
    );
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const onConfirmOwnerRoleChange = vi.fn();

    function Harness() {
      const changeRole = useChangeMembershipRole();
      const revoke = useRevokeMembership();
      return (
        <MembershipRowDialogs
          membership={membership({ userId: "target-1", role: "member" })}
          orgUnitId="u1"
          isSelf={false}
          confirmOwnerRole
          onConfirmOwnerRoleChange={onConfirmOwnerRoleChange}
          changeRole={changeRole}
          confirmRevoke={false}
          onConfirmRevokeChange={() => {}}
          revoke={revoke}
        />
      );
    }

    render(
      <QueryClientProvider client={queryClient}>
        <Harness />
      </QueryClientProvider>,
    );

    expect(screen.getByText("Make owner?")).toBeTruthy();
    expect(screen.getByText(/target-1/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Make owner" }));

    await waitFor(() =>
      expect(onConfirmOwnerRoleChange).toHaveBeenCalledWith(false),
    );
    const request = requestFromCall(
      fetchMock,
      lastCallIndex(fetchMock, "PATCH"),
    );
    expect(new URL(request.url).pathname).toBe(
      "/api/v1/org-units/u1/memberships/target-1",
    );
    expect(await request.clone().json()).toEqual({ role: "owner" });
  });
});
