import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, fn, screen, userEvent, waitFor, within } from "storybook/test";
import { vi, type Mock } from "vitest";

import type { OrgUnitResponse } from "@/lib/services/org-units/types";
import {
  jsonResponse,
  requestFromCall,
  stubFetch,
} from "@/lib/test-support/fetch-stub";
import {
  CreateOrgUnitDialog,
  MoveOrgUnitDialog,
  RenameOrgUnitDialog,
} from "./org-unit-dialogs";

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

// Acme
// └─ Team A
const acme = unit({ id: "org1", name: "Acme", type: "organization" });
const teamA = unit({
  id: "teamA",
  name: "Team A",
  parentId: "org1",
  type: "team",
  path: "org1/teamA",
});

// No hook mocking: the real org-unit mutations run against a stubbed
// globalThis.fetch. The root-organization POST and the unit PATCH (rename and
// move) are held until a story releases them, so a story can observe the
// dialog while the request is still in flight and prove it closes only once
// the server answers. The child-unit POST succeeds at once. An unrouted
// request fails the story.
let fetchMock: Mock<typeof fetch>;
let releaseCreate: () => void;
let releaseUpdate: () => void;

function routeFetch() {
  return () => {
    fetchMock = stubFetch();
    fetchMock.mockImplementation((input) => {
      const request = input instanceof Request ? input : new Request(input);
      const key = `${request.method} ${new URL(request.url).pathname}`;
      if (key === "POST /api/v1/org-units") {
        return new Promise<Response>((resolve) => {
          releaseCreate = () =>
            resolve(jsonResponse(unit({ id: "org9", name: "New Co" })));
        });
      }
      if (key === "POST /api/v1/org-units/org1/children") {
        return Promise.resolve(
          jsonResponse(
            unit({
              id: "dept9",
              name: "Design",
              parentId: "org1",
              type: "department",
            }),
          ),
        );
      }
      if (key === "PATCH /api/v1/org-units/teamA") {
        return new Promise<Response>((resolve) => {
          releaseUpdate = () => resolve(jsonResponse(teamA));
        });
      }
      throw new Error(`unrouted fetch in story: ${key}`);
    });
    return () => {
      vi.unstubAllGlobals();
    };
  };
}

/** Wait for the named dialog to finish fading in and return it. */
async function openedDialog(name: string) {
  // The dialog portals into document.body, outside the story canvas.
  const dialog = await screen.findByRole("dialog", { name });
  await waitFor(() => expect(dialog).toBeVisible());
  return within(dialog);
}

/** The `index`th request the dialog sent, once it has been sent. */
async function sentRequest(index = 0) {
  return waitFor(() => requestFromCall(fetchMock, index));
}

/** "METHOD /path" of every request sent so far, in order. */
function sentRoutes() {
  return fetchMock.mock.calls.map(([input]) => {
    const request = input instanceof Request ? input : new Request(input);
    return `${request.method} ${new URL(request.url).pathname}`;
  });
}

const meta = {
  component: CreateOrgUnitDialog,
  subcomponents: { RenameOrgUnitDialog, MoveOrgUnitDialog },
  tags: ["autodocs"],
  args: {
    open: true,
    onOpenChange: fn(),
  },
  beforeEach: routeFetch(),
} satisfies Meta<typeof CreateOrgUnitDialog>;

export default meta;
type Story = StoryObj<typeof meta>;
type RenameStory = StoryObj<typeof RenameOrgUnitDialog>;
type MoveStory = StoryObj<typeof MoveOrgUnitDialog>;

/**
 * Creating a root organization asks only for a name. Create stays disabled
 * until one is typed, then POSTs it; the dialog stays open, with Create
 * disabled, until the server answers, then closes.
 *
 * @summary new organization: Create sends the name and closes once created
 */
export const CreateRoot: Story = {
  tags: ["ai-generated"],
  play: async ({ args }) => {
    const dialog = await openedDialog("New organization");
    const field = dialog.getByLabelText("Name");
    const create = dialog.getByRole("button", { name: "Create" });
    await expect(dialog.queryByRole("group", { name: "Type" })).toBeNull();
    await expect(create).toBeDisabled();

    await userEvent.type(field, "New Co");
    await expect(create).toBeEnabled();
    await userEvent.click(create);

    const request = await sentRequest();
    await expect(sentRoutes()).toEqual(["POST /api/v1/org-units"]);
    await expect(request.clone().json()).resolves.toEqual({ name: "New Co" });
    await waitFor(() => expect(create).toBeDisabled());
    await expect(args.onOpenChange).not.toHaveBeenCalled();

    releaseCreate();

    await waitFor(() => expect(args.onOpenChange).toHaveBeenCalledWith(false));
    await expect(fetchMock).toHaveBeenCalledTimes(1);
  },
};

/**
 * A blank or spaces-only name keeps Create disabled, and Enter in the field
 * sends nothing either; Enter with a real name creates the organization with
 * the surrounding spaces trimmed off.
 *
 * @summary new organization: a blank name is never sent; Enter trims and sends
 */
export const CreateRootEnter: Story = {
  tags: ["ai-generated"],
  play: async () => {
    const dialog = await openedDialog("New organization");
    const field = dialog.getByLabelText("Name");

    await userEvent.type(field, "   ");
    await expect(dialog.getByRole("button", { name: "Create" })).toBeDisabled();
    await userEvent.keyboard("{Enter}");

    await userEvent.clear(field);
    await userEvent.type(field, "  Spaced Co  {Enter}");

    // Had the blank Enter been sent, it would be the first request.
    const request = await sentRequest();
    await expect(sentRoutes()).toEqual(["POST /api/v1/org-units"]);
    await expect(request.clone().json()).resolves.toEqual({
      name: "Spaced Co",
    });
    releaseCreate();
  },
};

/**
 * Cancelling a typed name closes the dialog without creating anything.
 *
 * @summary new organization: Cancel closes without a request
 */
export const CreateCancel: Story = {
  tags: ["ai-generated"],
  play: async ({ args }) => {
    const dialog = await openedDialog("New organization");

    await userEvent.type(dialog.getByLabelText("Name"), "New Co");
    await userEvent.click(dialog.getByRole("button", { name: "Cancel" }));

    await expect(args.onOpenChange).toHaveBeenCalledWith(false);
    await expect(fetchMock).not.toHaveBeenCalled();
  },
};

/**
 * Creating under a parent names that parent in the title and adds a type
 * picker that starts on Group. The chosen type is sent with the name to the
 * parent's children, and the dialog closes once the unit is created.
 *
 * @summary new child unit: sends the name and picked type under the parent
 */
export const CreateChild: Story = {
  tags: ["ai-generated"],
  args: { parent: acme },
  play: async ({ args }) => {
    const dialog = await openedDialog("New unit under “Acme”");
    const types = within(dialog.getByRole("group", { name: "Type" }));
    const department = types.getByRole("button", { name: "Department" });
    await expect(types.getByRole("button", { name: "Group" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(department).toHaveAttribute("aria-pressed", "false");

    await userEvent.type(dialog.getByLabelText("Name"), "Design");
    await userEvent.click(department);
    await expect(department).toHaveAttribute("aria-pressed", "true");
    await userEvent.click(dialog.getByRole("button", { name: "Create" }));

    const request = await sentRequest();
    await expect(sentRoutes()).toEqual([
      "POST /api/v1/org-units/org1/children",
    ]);
    await expect(request.clone().json()).resolves.toEqual({
      name: "Design",
      type: "department",
    });
    await waitFor(() => expect(args.onOpenChange).toHaveBeenCalledWith(false));
  },
};

const unitArgs = { unit: teamA, open: true, onOpenChange: fn() };

/**
 * The field starts from the unit's name; saving it unchanged just closes the
 * dialog, and nothing is sent.
 *
 * @summary rename: Save with the same name closes without a request
 */
export const RenameUnchanged: RenameStory = {
  tags: ["ai-generated"],
  args: unitArgs,
  render: (args) => <RenameOrgUnitDialog {...args} />,
  play: async ({ args }) => {
    const dialog = await openedDialog("Rename “Team A”");
    await expect(dialog.getByLabelText("Name")).toHaveValue("Team A");

    await userEvent.click(dialog.getByRole("button", { name: "Save" }));

    await expect(args.onOpenChange).toHaveBeenCalledWith(false);
    await expect(fetchMock).not.toHaveBeenCalled();
  },
};

/**
 * Saving a new name PATCHes the unit with it; the dialog stays open, with
 * Save disabled, until the server accepts it, then closes.
 *
 * @summary rename: Save with a new name sends it and closes once saved
 */
export const RenameChanged: RenameStory = {
  tags: ["ai-generated"],
  args: unitArgs,
  render: (args) => <RenameOrgUnitDialog {...args} />,
  play: async ({ args }) => {
    const dialog = await openedDialog("Rename “Team A”");
    const field = dialog.getByLabelText("Name");
    const save = dialog.getByRole("button", { name: "Save" });

    await userEvent.clear(field);
    await userEvent.type(field, "Team Alpha");
    await userEvent.click(save);

    const request = await sentRequest();
    await expect(sentRoutes()).toEqual(["PATCH /api/v1/org-units/teamA"]);
    await expect(request.clone().json()).resolves.toEqual({
      name: "Team Alpha",
    });
    await waitFor(() => expect(save).toBeDisabled());
    await expect(args.onOpenChange).not.toHaveBeenCalled();

    releaseUpdate();

    await waitFor(() => expect(args.onOpenChange).toHaveBeenCalledWith(false));
  },
};

/**
 * Enter in the name field saves the new name, like the Save button.
 *
 * @summary rename: Enter sends the new name
 */
export const RenameEnter: RenameStory = {
  tags: ["ai-generated"],
  args: unitArgs,
  render: (args) => <RenameOrgUnitDialog {...args} />,
  play: async () => {
    const dialog = await openedDialog("Rename “Team A”");
    const field = dialog.getByLabelText("Name");

    await userEvent.clear(field);
    await userEvent.type(field, "Team Alpha{Enter}");

    const request = await sentRequest();
    await expect(sentRoutes()).toEqual(["PATCH /api/v1/org-units/teamA"]);
    await expect(request.clone().json()).resolves.toEqual({
      name: "Team Alpha",
    });
    releaseUpdate();
  },
};

/**
 * Cancelling an edited name closes the dialog without renaming the unit.
 *
 * @summary rename: Cancel closes without a request
 */
export const RenameCancel: RenameStory = {
  tags: ["ai-generated"],
  args: unitArgs,
  render: (args) => <RenameOrgUnitDialog {...args} />,
  play: async ({ args }) => {
    const dialog = await openedDialog("Rename “Team A”");
    const field = dialog.getByLabelText("Name");

    await userEvent.clear(field);
    await userEvent.type(field, "Something else");
    await userEvent.click(dialog.getByRole("button", { name: "Cancel" }));

    await expect(args.onOpenChange).toHaveBeenCalledWith(false);
    await expect(fetchMock).not.toHaveBeenCalled();
  },
};

const moveArgs = { ...unitArgs, units: [acme, teamA] };

/**
 * The picker opens on the unit's current parent with Move disabled. Picking
 * "make root" enables Move, which PATCHes the unit to have no parent; the
 * dialog stays open until the server accepts it, then closes.
 *
 * @summary move: picking a new parent enables Move, which sends it
 */
export const Move: MoveStory = {
  tags: ["ai-generated"],
  args: moveArgs,
  render: (args) => <MoveOrgUnitDialog {...args} />,
  play: async ({ args }) => {
    const dialog = await openedDialog("Move “Team A”");
    const makeRoot = dialog.getByRole("option", {
      name: "— Make root organization —",
    });
    const move = dialog.getByRole("button", { name: "Move" });
    await expect(dialog.getByRole("option", { name: "Acme" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await expect(move).toBeDisabled();

    await userEvent.click(makeRoot);
    await expect(makeRoot).toHaveAttribute("aria-selected", "true");
    await expect(move).toBeEnabled();
    await userEvent.click(move);

    const request = await sentRequest();
    await expect(sentRoutes()).toEqual(["PATCH /api/v1/org-units/teamA"]);
    await expect(request.clone().json()).resolves.toEqual({ parentId: null });
    await expect(args.onOpenChange).not.toHaveBeenCalled();

    releaseUpdate();

    await waitFor(() => expect(args.onOpenChange).toHaveBeenCalledWith(false));
  },
};

/**
 * Cancelling after picking a new parent closes the dialog without moving the
 * unit.
 *
 * @summary move: Cancel closes without a request
 */
export const MoveCancel: MoveStory = {
  tags: ["ai-generated"],
  args: moveArgs,
  render: (args) => <MoveOrgUnitDialog {...args} />,
  play: async ({ args }) => {
    const dialog = await openedDialog("Move “Team A”");

    await userEvent.click(
      dialog.getByRole("option", { name: "— Make root organization —" }),
    );
    await userEvent.click(dialog.getByRole("button", { name: "Cancel" }));

    await expect(args.onOpenChange).toHaveBeenCalledWith(false);
    await expect(fetchMock).not.toHaveBeenCalled();
  },
};
