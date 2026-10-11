import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, screen, userEvent, waitFor, within } from "storybook/test";
import { vi, type Mock } from "vitest";
import { contrastKnownIssue232 } from "@workspace/ui/components/known-a11y-issues";

import type {
  MembershipResponse,
  OrgUnitResponse,
} from "@/lib/services/org-units/types";
import { jsonResponse, stubFetch } from "@/lib/test-support/fetch-stub";
import { MembersPanel } from "./members-panel";

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

const acme = unit({ id: "u1", name: "Acme" });
const eng = unit({
  id: "u2",
  name: "Acme / Eng",
  parentId: "u1",
  type: "team",
  path: "u1/u2",
});

type Handler = (request: Request) => Response | Promise<Response>;

const notFound = () => jsonResponse({ message: "not found" }, 404);
const ownerHere = () =>
  jsonResponse({ role: "owner", viaOrgUnitId: "u1", inherited: false });

// No hook mocking: the real query and mutation hooks run against a stubbed
// globalThis.fetch routed by method and path, so every mutation is proved by
// the request it actually sends. An unrouted request fails the story.
let fetchMock: Mock<typeof fetch>;

function routeFetch(handlers: Record<string, Handler>) {
  return () => {
    fetchMock = stubFetch();
    fetchMock.mockImplementation(async (input) => {
      const request = input instanceof Request ? input : new Request(input);
      const key = `${request.method} ${new URL(request.url).pathname}`;
      const handler =
        key === "GET /auth/v1/me"
          ? () =>
              jsonResponse({
                id: "me-1",
                name: "Leo",
                email: "leo@example.com",
                emailVerified: null,
                image: null,
              })
          : handlers[key];
      if (!handler) throw new Error(`unrouted fetch in story: ${key}`);
      return handler(request);
    });
    return () => {
      vi.unstubAllGlobals();
    };
  };
}

/** The most recent request sent with `method`. A mutation's success kicks off
 *  cache-invalidation refetches, so the last call overall may be a GET. */
function sentRequest(method: string): Promise<Request> {
  return waitFor(() => {
    const found = fetchMock.mock.calls
      .map(([input]) => input)
      .filter(
        (input): input is Request =>
          input instanceof Request && input.method === method,
      )
      .at(-1);
    if (!found) throw new Error(`no ${method} request sent yet`);
    return found;
  });
}

/** Wait for the alert dialog titled `title` to finish fading in. */
async function openedDialog(title: string) {
  const dialog = await screen.findByRole("alertdialog", { name: title });
  await waitFor(() => expect(dialog).toBeVisible());
  return dialog;
}

const meta = {
  component: MembersPanel,
  tags: ["autodocs"],
  args: { orgUnitId: "u1", units: [acme] },
} satisfies Meta<typeof MembersPanel>;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * Before the roster and the caller's role resolve, both say they are loading.
 *
 * @summary loading copy for the roster and the caller's role
 */
export const Loading: Story = {
  tags: ["ai-generated"],
  beforeEach: routeFetch({
    // Responses that never arrive hold both queries in their loading state.
    // (Executor form: this workspace's TS lib predates Promise.withResolvers.)
    "GET /api/v1/org-units/u1/memberships": () => new Promise(() => {}),
    "GET /api/v1/org-units/u1/memberships/me": () => new Promise(() => {}),
  }),
  play: async ({ canvas }) => {
    await expect(canvas.getByText("Loading roster…")).toBeVisible();
    await expect(canvas.getByText("Loading your role…")).toBeVisible();
  },
};

/**
 * A unit with no visible members and no role for the caller says so, and the
 * Grant button stays disabled while the user id is blank.
 *
 * @summary empty roster, no role, and a disabled blank grant
 */
export const Empty: Story = {
  tags: ["ai-generated"],
  beforeEach: routeFetch({
    "GET /api/v1/org-units/u1/memberships": () => jsonResponse([]),
    "GET /api/v1/org-units/u1/memberships/me": notFound,
  }),
  play: async ({ canvas }) => {
    await expect(
      await canvas.findByText("No members visible here yet."),
    ).toBeVisible();
    await expect(
      canvas.getByText("You have no role on this unit."),
    ).toBeVisible();
    await expect(canvas.getByRole("button", { name: "Grant" })).toBeDisabled();
  },
};

/**
 * The roster marks the caller's own row as "(you)", the header states the
 * caller's direct role, and a service account's role is shown but cannot be
 * changed.
 *
 * @summary roster with the caller marked and a locked service-account role
 */
export const Roster: Story = {
  tags: ["ai-generated"],
  beforeEach: routeFetch({
    "GET /api/v1/org-units/u1/memberships": () =>
      jsonResponse([
        membership({ userId: "me-1", role: "owner" }),
        membership({ userId: "svc-1", role: "service_account" }),
      ]),
    "GET /api/v1/org-units/u1/memberships/me": ownerHere,
  }),
  play: async ({ canvas }) => {
    const myRow = await canvas.findByTestId("membership-row-me-1");
    await expect(within(myRow).getByText("(you)")).toBeVisible();
    await expect(canvas.getByText("Your role here: Owner")).toBeVisible();

    const svcRow = canvas.getByTestId("membership-row-svc-1");
    await expect(within(svcRow).queryByText("(you)")).toBeNull();
    await expect(
      within(svcRow).getByRole("button", { name: "Service account" }),
    ).toBeDisabled();
  },
};

/**
 * A role inherited from an ancestor names that ancestor unit.
 *
 * @summary inherited role names the ancestor unit
 */
export const InheritedRole: Story = {
  tags: ["ai-generated"],
  args: { orgUnitId: "u2", units: [acme, eng] },
  beforeEach: routeFetch({
    "GET /api/v1/org-units/u2/memberships": () => jsonResponse([]),
    "GET /api/v1/org-units/u2/memberships/me": () =>
      jsonResponse({ role: "admin", viaOrgUnitId: "u1", inherited: true }),
  }),
  play: async ({ canvas }) => {
    await expect(
      await canvas.findByText("Your role here: Admin (inherited from Acme)"),
    ).toBeVisible();
  },
};

/**
 * Granting sends the typed user id at the default Member role and clears the
 * field once the grant succeeds.
 *
 * @summary grant at the default role, then clear the field
 */
export const GrantMember: Story = {
  tags: ["ai-generated"],
  beforeEach: routeFetch({
    "GET /api/v1/org-units/u1/memberships": () => jsonResponse([]),
    "GET /api/v1/org-units/u1/memberships/me": notFound,
    "POST /api/v1/org-units/u1/memberships": () => jsonResponse(null),
  }),
  play: async ({ canvas }) => {
    await canvas.findByText("No members visible here yet.");
    const input = canvas.getByLabelText("User ID");
    await userEvent.type(input, "new-user");
    await userEvent.click(canvas.getByRole("button", { name: "Grant" }));

    await waitFor(() => expect(input).toHaveValue(""));
    const request = await sentRequest("POST");
    await expect(new URL(request.url).pathname).toBe(
      "/api/v1/org-units/u1/memberships",
    );
    await expect(await request.clone().json()).toEqual({
      userId: "new-user",
      role: "member",
    });
  },
};

/**
 * Granting the Owner role first asks for confirmation naming the grantee;
 * nothing is sent until the grant is confirmed.
 *
 * @summary an owner grant confirms first, naming the grantee
 */
export const GrantOwnership: Story = {
  tags: ["ai-generated"],
  beforeEach: routeFetch({
    "GET /api/v1/org-units/u1/memberships": () => jsonResponse([]),
    "GET /api/v1/org-units/u1/memberships/me": notFound,
    "POST /api/v1/org-units/u1/memberships": () => jsonResponse(null),
  }),
  play: async ({ canvas }) => {
    await canvas.findByText("No members visible here yet.");
    await userEvent.type(canvas.getByLabelText("User ID"), "new-owner");
    await userEvent.click(canvas.getByRole("button", { name: "Member" }));
    await userEvent.click(
      await screen.findByRole("menuitemradio", { name: "Owner" }),
    );
    await userEvent.click(canvas.getByRole("button", { name: "Grant" }));

    const dialog = await openedDialog("Grant ownership?");
    await expect(within(dialog).getByText(/“new-owner”/)).toBeVisible();
    await expect(
      fetchMock.mock.calls.some(
        ([input]) => input instanceof Request && input.method === "POST",
      ),
    ).toBe(false);

    await userEvent.click(
      within(dialog).getByRole("button", { name: "Grant ownership" }),
    );
    const request = await sentRequest("POST");
    await expect(await request.clone().json()).toEqual({
      userId: "new-owner",
      role: "owner",
    });
  },
};

/**
 * Promoting a member to Owner from the row's role control asks for
 * confirmation naming them, sends the role change, and closes once it lands.
 *
 * @summary make-owner confirms, then sends the role change
 */
export const MakeOwner: Story = {
  tags: ["ai-generated"],
  beforeEach: routeFetch({
    "GET /api/v1/org-units/u1/memberships": () =>
      jsonResponse([membership({ userId: "target-1", role: "member" })]),
    "GET /api/v1/org-units/u1/memberships/me": ownerHere,
    "PATCH /api/v1/org-units/u1/memberships/target-1": () =>
      jsonResponse(membership({ userId: "target-1", role: "owner" })),
  }),
  play: async ({ canvas }) => {
    const row = await canvas.findByTestId("membership-row-target-1");
    await userEvent.click(within(row).getByRole("button", { name: "Member" }));
    await userEvent.click(
      await screen.findByRole("menuitemradio", { name: "Owner" }),
    );

    const dialog = await openedDialog("Make owner?");
    await expect(within(dialog).getByText(/target-1/)).toBeVisible();
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Make owner" }),
    );

    const request = await sentRequest("PATCH");
    await expect(new URL(request.url).pathname).toBe(
      "/api/v1/org-units/u1/memberships/target-1",
    );
    await expect(await request.clone().json()).toEqual({ role: "owner" });
    await waitFor(() => expect(dialog).not.toBeInTheDocument());
  },
};

/**
 * Revoking another member confirms with "Revoke" wording, sends the revoke for
 * that member, and closes once it lands.
 *
 * @summary revoke another member after confirming
 */
export const RevokeMember: Story = {
  tags: ["ai-generated"],
  beforeEach: routeFetch({
    "GET /api/v1/org-units/u1/memberships": () =>
      jsonResponse([membership({ userId: "other-1", role: "member" })]),
    "GET /api/v1/org-units/u1/memberships/me": ownerHere,
    "DELETE /api/v1/org-units/u1/memberships/other-1": () => jsonResponse(null),
  }),
  play: async ({ canvas }) => {
    const row = await canvas.findByTestId("membership-row-other-1");
    await userEvent.click(within(row).getByRole("button", { name: "Revoke" }));

    const dialog = await openedDialog("Revoke other-1?");
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Revoke" }),
    );

    const request = await sentRequest("DELETE");
    await expect(new URL(request.url).pathname).toBe(
      "/api/v1/org-units/u1/memberships/other-1",
    );
    await waitFor(() => expect(dialog).not.toBeInTheDocument());
  },
};

/**
 * Revoking the caller's own membership is worded as leaving the unit, and the
 * confirmation spells out the consequence.
 *
 * @summary the caller's own row offers Leave, not Revoke
 */
export const LeaveUnit: Story = {
  tags: ["ai-generated"],
  // The open dialog's destructive Leave button (destructive on
  // bg-destructive/10, ~3.8:1) is the tracked #232 token contrast defect.
  parameters: contrastKnownIssue232,
  beforeEach: routeFetch({
    "GET /api/v1/org-units/u1/memberships": () =>
      jsonResponse([membership({ userId: "me-1", role: "admin" })]),
    "GET /api/v1/org-units/u1/memberships/me": () =>
      jsonResponse({ role: "admin", viaOrgUnitId: "u1", inherited: false }),
  }),
  play: async ({ canvas }) => {
    const row = await canvas.findByTestId("membership-row-me-1");
    await expect(
      within(row).queryByRole("button", { name: "Revoke" }),
    ).toBeNull();
    await userEvent.click(within(row).getByRole("button", { name: "Leave" }));

    const dialog = await openedDialog("Leave this unit?");
    await expect(
      within(dialog).getByText(
        "You’ll lose your role and access here. An admin or owner can re-add you later.",
      ),
    ).toBeVisible();
  },
};

/**
 * When leaving fails because the caller is the last owner, the explanation
 * appears inside the confirmation, which stays open.
 *
 * @summary a failed leave explains why and keeps the dialog open
 */
export const LeaveBlockedAsLastOwner: Story = {
  tags: ["ai-generated"],
  // The dialog stays open on its destructive Leave button — #232, as above.
  parameters: contrastKnownIssue232,
  beforeEach: routeFetch({
    "GET /api/v1/org-units/u1/memberships": () =>
      jsonResponse([membership({ userId: "me-1", role: "owner" })]),
    "GET /api/v1/org-units/u1/memberships/me": ownerHere,
    "DELETE /api/v1/org-units/u1/memberships/me-1": () =>
      jsonResponse({ code: "LAST_OWNER" }, 409),
  }),
  play: async ({ canvas }) => {
    const row = await canvas.findByTestId("membership-row-me-1");
    await userEvent.click(within(row).getByRole("button", { name: "Leave" }));

    const dialog = await openedDialog("Leave this unit?");
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Leave" }),
    );

    await expect(
      await within(dialog).findByText(
        "You’re the last owner here — transfer ownership first. Use the role control next to another member to make them owner, then try again.",
      ),
    ).toBeVisible();
    await expect(dialog).toBeVisible();
  },
};
