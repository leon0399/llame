import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { contrastKnownIssue232 } from "@workspace/ui/components/known-a11y-issues";
import { SidebarProvider } from "@workspace/ui/components/sidebar";
import { expect, screen, userEvent, waitFor, within } from "storybook/test";
import { vi, type Mock } from "vitest";

// Import the pins hooks via the REAL specifier: sb.mock (preview.tsx) redirects
// them to the __mocks__ module, which keeps pin/unpin/reorder off the network.
// The stable `unpinMutate` control comes from that manual mock and is injected
// into the redirected hook in `beforeEach`, so component and story share it.
import * as pinsMutations from "@/lib/services/pins/mutations";
import { unpinMutate } from "@/lib/services/pins/__mocks__/mutations";
import { usePins } from "@/lib/services/pins/queries";
import type { PinnedItem } from "@/lib/services/pins/types";
import {
  emptyResponse,
  jsonResponse,
  stubFetch,
} from "@/lib/test-support/fetch-stub";
import { AppSidebarPinned } from "./app-sidebar-pinned";

const useUnpinItem = vi.mocked(pinsMutations.useUnpinItem, { partial: true });

const chatPin: PinnedItem = {
  itemType: "chat",
  itemId: "c1",
  pinnedAt: "2026-01-01T00:00:00.000Z",
  item: { id: "c1", title: "Trip to Lisbon", archivedAt: null },
};

const projectPin: PinnedItem = {
  itemType: "project",
  itemId: "p1",
  pinnedAt: "2026-01-02T00:00:00.000Z",
  item: { id: "p1", name: "Acme relaunch", archivedAt: null },
};

const archivedAt = "2026-01-03T00:00:00.000Z";
const archivedChatPin: PinnedItem = {
  ...chatPin,
  item: { id: "c1", title: "Trip to Lisbon", archivedAt },
};
const archivedProjectPin: PinnedItem = {
  ...projectPin,
  item: { id: "p1", name: "Acme relaunch", archivedAt },
};

// No query or archive hook mocking: the real usePins, useSetChatArchive and
// useSetProjectArchive run against a stubbed globalThis.fetch. GET /pins
// answers with the story's `pins` parameter (held until the story releases it
// when `holdPins` is set). An archive PATCH succeeds and the stub server then
// holds only that item, archived, so the refetch it triggers returns the
// archived pin. An unrouted request fails the story.
let fetchMock: Mock<typeof fetch>;
let serverPins: Array<PinnedItem>;
let releasePins: () => void;
/** The project's description as the server holds it now; undefined makes
 *  the project's read fail. */
let serverDescription: string | undefined;

type PinsParameters = { pins?: Array<PinnedItem>; holdPins?: boolean };

function routeFetch() {
  return ({ parameters }: { parameters: PinsParameters }) => {
    serverPins = parameters.pins ?? [];
    serverDescription = "Everything about the relaunch";
    const holdPins = parameters.holdPins === true;
    unpinMutate.mockClear();
    useUnpinItem.mockReturnValue({ mutate: unpinMutate, isPending: false });
    fetchMock = stubFetch();
    fetchMock.mockImplementation((input) => {
      const request = input instanceof Request ? input : new Request(input);
      const key = `${request.method} ${new URL(request.url).pathname}`;
      if (key === "GET /api/v1/pins") {
        if (holdPins) {
          return new Promise<Response>((resolve) => {
            releasePins = () => resolve(jsonResponse(serverPins));
          });
        }
        return Promise.resolve(jsonResponse(serverPins));
      }
      if (key === "PATCH /api/v1/chats/c1") {
        serverPins = [archivedChatPin];
        return Promise.resolve(emptyResponse());
      }
      if (key === "PATCH /api/v1/projects/p1") {
        serverPins = [archivedProjectPin];
        return Promise.resolve(emptyResponse());
      }
      if (key === "GET /api/v1/projects/p1") {
        if (serverDescription === undefined) {
          return Promise.resolve(new Response(null, { status: 500 }));
        }
        return Promise.resolve(
          jsonResponse({
            id: "p1",
            ownerUserId: "u1",
            name: "Acme relaunch",
            description: serverDescription,
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z",
            archivedAt: null,
          }),
        );
      }
      throw new Error(`unrouted fetch in story: ${key}`);
    });
    return () => {
      vi.unstubAllGlobals();
    };
  };
}

/** "METHOD /path" of every request sent so far, in order. */
function sentRoutes() {
  return fetchMock.mock.calls.map(([input]) => {
    const request = input instanceof Request ? input : new Request(input);
    return `${request.method} ${new URL(request.url).pathname}`;
  });
}

/** The JSON body of the first request sent to `route`. */
async function sentBody(route: string) {
  const index = sentRoutes().indexOf(route);
  const input = fetchMock.mock.calls[index]?.[0];
  if (!(input instanceof Request)) {
    throw new Error(`expected a Request for ${route}`);
  }
  return input.clone().json();
}

/** Open the only row's "…" menu and return the menu once it is shown. */
async function openRowMenu(canvasElement: HTMLElement) {
  const canvas = within(canvasElement);
  await userEvent.click(await canvas.findByRole("button", { name: "More" }));
  // The menu portals into document.body, outside the story canvas.
  const menu = await screen.findByRole("menu");
  await waitFor(() => expect(menu).toBeVisible());
  return within(menu);
}

/** Choose `name` from the only row's "…" menu and wait for the menu to close. */
async function chooseFromRowMenu(canvasElement: HTMLElement, name: string) {
  const menu = await openRowMenu(canvasElement);
  await userEvent.click(menu.getByRole("menuitem", { name }));
  await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
}

/** Wait for the named dialog to finish fading in and return it. */
async function openedDialog(role: "dialog" | "alertdialog", name: string) {
  // The dialog portals into document.body, outside the story canvas.
  const dialog = await screen.findByRole(role, { name });
  await waitFor(() => expect(dialog).toBeVisible());
  return within(dialog);
}

const meta = {
  component: AppSidebarPinned,
  tags: ["autodocs"],
  parameters: {
    layout: "centered",
    nextjs: { appDirectory: true, navigation: { pathname: "/" } },
    pins: [projectPin, chatPin],
  },
  decorators: [
    (Story) => (
      <SidebarProvider className="min-h-0 w-fit">
        <div className="w-64">
          <Story />
        </div>
      </SidebarProvider>
    ),
  ],
  beforeEach: routeFetch(),
} satisfies Meta<typeof AppSidebarPinned>;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * Stands in for the rail around the section: the section's own slot, plus a
 * line that reads the same pins query so a story can tell when the server has
 * answered.
 */
function PinnedSlot() {
  const { status } = usePins();
  return (
    <>
      <div data-testid="pinned-slot">
        <AppSidebarPinned />
      </div>
      <p>Pins request: {status}</p>
    </>
  );
}

/**
 * With no pins the section renders nothing at all — no "Pinned" label over an
 * empty group, no divider — both while the pins are loading and once the
 * server answers with none.
 *
 * @summary no pins: nothing while loading, nothing once loaded empty
 */
export const NoPins: Story = {
  tags: ["ai-generated"],
  parameters: { pins: [], holdPins: true },
  render: () => <PinnedSlot />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const slot = canvas.getByTestId("pinned-slot");

    await waitFor(() => expect(sentRoutes()).toEqual(["GET /api/v1/pins"]));
    await expect(canvas.getByText("Pins request: pending")).toBeVisible();
    await expect(slot).toBeEmptyDOMElement();

    releasePins();

    await canvas.findByText("Pins request: success");
    await expect(slot).toBeEmptyDOMElement();
  },
};

/**
 * Chats and projects share one "Pinned" section, in the order the server
 * returns them (pin recency), each row linking to its chat or project.
 *
 * @summary mixed chats and projects in server order
 */
export const Basic: Story = {
  tags: ["ai-generated"],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(await canvas.findByText("Pinned")).toBeVisible();
    const rows = canvas.getAllByRole("link");
    await expect(rows.map((row) => row.textContent)).toEqual([
      "Acme relaunch",
      "Trip to Lisbon",
    ]);
    await expect(rows[0]).toHaveAttribute("href", "/projects/p1");
    await expect(rows[1]).toHaveAttribute("href", "/chat/c1");
    await expect(sentRoutes()).toEqual(["GET /api/v1/pins"]);
  },
};

/**
 * A pinned chat whose title is not generated yet shows the "New chat"
 * placeholder.
 *
 * @summary an untitled pinned chat shows "New chat"
 */
export const UntitledChat: Story = {
  tags: ["ai-generated"],
  parameters: {
    pins: [{ ...chatPin, item: { id: "c1", title: null, archivedAt: null } }],
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const row = await canvas.findByRole("link");
    await expect(row).toHaveTextContent("New chat");
    await expect(row).toHaveAttribute("href", "/chat/c1");
  },
};

/**
 * The pinned chat's menu is a subset of the chat list row's: Unpin, Rename,
 * Archive and Delete. The rail holds only the chat's reference card, so the
 * actions that need the full chat (move to a project, share, export, fork)
 * are absent.
 *
 * @summary pinned chat menu: unpin, rename, archive, delete only
 */
export const ChatRowMenu: Story = {
  tags: ["ai-generated"],
  parameters: { pins: [chatPin] },
  play: async ({ canvasElement }) => {
    const menu = await openRowMenu(canvasElement);

    await expect(
      menu.getAllByRole("menuitem").map((item) => item.textContent),
    ).toEqual(["Unpin", "Rename", "Archive", "Delete"]);
    await expect(menu.queryByRole("menuitem", { name: /project/i })).toBeNull();
    await expect(menu.queryByRole("menuitem", { name: "Share" })).toBeNull();
    await expect(
      menu.queryByRole("menuitem", { name: "Export as Markdown" }),
    ).toBeNull();
    await expect(menu.queryByRole("menuitem", { name: "Fork" })).toBeNull();
  },
};

/**
 * Unpin unpins the chat by its item type and id.
 *
 * @summary pinned chat menu: Unpin unpins the chat
 */
export const ChatUnpin: Story = {
  tags: ["ai-generated"],
  parameters: { pins: [chatPin] },
  play: async ({ canvasElement }) => {
    await chooseFromRowMenu(canvasElement, "Unpin");

    await expect(unpinMutate).toHaveBeenCalledTimes(1);
    await expect(unpinMutate).toHaveBeenCalledWith({
      itemType: "chat",
      itemId: "c1",
    });
  },
};

/**
 * Archive archives the chat; once the server accepts it, the refreshed row
 * carries the "Archived" pill.
 *
 * @summary pinned chat menu: Archive archives the chat
 */
export const ChatArchive: Story = {
  tags: ["ai-generated"],
  parameters: { pins: [chatPin] },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await chooseFromRowMenu(canvasElement, "Archive");

    await expect(
      await within(await canvas.findByRole("link")).findByText("Archived"),
    ).toBeVisible();
    await expect(sentRoutes()).toEqual([
      "GET /api/v1/pins",
      "PATCH /api/v1/chats/c1",
      "GET /api/v1/pins",
    ]);
    await expect(sentBody("PATCH /api/v1/chats/c1")).resolves.toEqual({
      archived: true,
    });
  },
};

/**
 * Rename opens the rename dialog for the chat, filled with its title.
 *
 * @summary pinned chat menu: Rename opens the rename dialog
 */
export const ChatRename: Story = {
  tags: ["ai-generated"],
  parameters: { pins: [chatPin] },
  play: async ({ canvasElement }) => {
    const menu = await openRowMenu(canvasElement);

    await userEvent.click(menu.getByRole("menuitem", { name: "Rename" }));

    const dialog = await openedDialog("dialog", "Rename chat");
    await expect(dialog.getByLabelText("Chat title")).toHaveValue(
      "Trip to Lisbon",
    );
    await expect(sentRoutes()).toEqual(["GET /api/v1/pins"]);
  },
};

/**
 * Delete asks for confirmation before anything is deleted.
 *
 * @summary pinned chat menu: Delete opens the confirmation
 */
export const ChatDelete: Story = {
  tags: ["ai-generated"],
  // #232 — the confirm button is base-nova's subtle destructive Button
  // (~3.82:1), the tracked low-contrast token defect.
  parameters: { pins: [chatPin], ...contrastKnownIssue232 },
  play: async ({ canvasElement }) => {
    const menu = await openRowMenu(canvasElement);

    await userEvent.click(menu.getByRole("menuitem", { name: "Delete" }));

    const dialog = await openedDialog("alertdialog", "Delete chat?");
    await expect(
      dialog.getByRole("button", { name: "Delete" }),
    ).toBeInTheDocument();
    await expect(sentRoutes()).toEqual(["GET /api/v1/pins"]);
  },
};

/**
 * The pinned project's menu carries Unpin, Edit details, Archive and Delete;
 * Edit details is its only edit action.
 *
 * @summary pinned project menu: unpin, edit details, archive, delete
 */
export const ProjectRowMenu: Story = {
  tags: ["ai-generated"],
  parameters: { pins: [projectPin] },
  play: async ({ canvasElement }) => {
    const menu = await openRowMenu(canvasElement);

    await expect(
      menu.getAllByRole("menuitem").map((item) => item.textContent),
    ).toEqual(["Unpin", "Edit details", "Archive", "Delete"]);
  },
};

/**
 * Unpin unpins the project by its item type and id.
 *
 * @summary pinned project menu: Unpin unpins the project
 */
export const ProjectUnpin: Story = {
  tags: ["ai-generated"],
  parameters: { pins: [projectPin] },
  play: async ({ canvasElement }) => {
    await chooseFromRowMenu(canvasElement, "Unpin");

    await expect(unpinMutate).toHaveBeenCalledTimes(1);
    await expect(unpinMutate).toHaveBeenCalledWith({
      itemType: "project",
      itemId: "p1",
    });
  },
};

/**
 * Archive archives the project; once the server accepts it, the refreshed row
 * carries the "Archived" pill.
 *
 * @summary pinned project menu: Archive archives the project
 */
export const ProjectArchive: Story = {
  tags: ["ai-generated"],
  parameters: { pins: [projectPin] },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await chooseFromRowMenu(canvasElement, "Archive");

    await expect(
      await within(await canvas.findByRole("link")).findByText("Archived"),
    ).toBeVisible();
    await expect(sentRoutes()).toEqual([
      "GET /api/v1/pins",
      "PATCH /api/v1/projects/p1",
      "GET /api/v1/pins",
    ]);
    await expect(sentBody("PATCH /api/v1/projects/p1")).resolves.toEqual({
      archived: true,
    });
  },
};

/**
 * The pin holds only the project's name, so Edit details reads the project
 * when chosen and opens seeded with its name and description.
 *
 * @summary pinned project menu: Edit details reads the project and opens seeded
 */
export const ProjectEditDetails: Story = {
  tags: ["ai-generated"],
  parameters: { pins: [projectPin] },
  play: async ({ canvasElement }) => {
    await chooseFromRowMenu(canvasElement, "Edit details");

    const dialog = await openedDialog("dialog", "Edit details");
    await expect(dialog.getByLabelText("Name")).toHaveValue("Acme relaunch");
    await expect(dialog.getByLabelText("Description")).toHaveValue(
      "Everything about the relaunch",
    );
    await expect(sentRoutes()).toEqual([
      "GET /api/v1/pins",
      "GET /api/v1/projects/p1",
    ]);
  },
};

/**
 * Closing the dialog keeps the row mounted, and the project read with it, so
 * a reopen must read the project again rather than seed from the copy of the
 * first open: here the description changed elsewhere in between.
 *
 * @summary pinned project menu: reopening Edit details reads the project again
 */
export const ProjectEditDetailsReopen: Story = {
  tags: ["ai-generated"],
  parameters: { pins: [projectPin] },
  play: async ({ canvasElement }) => {
    await chooseFromRowMenu(canvasElement, "Edit details");
    const first = await openedDialog("dialog", "Edit details");
    await expect(first.getByLabelText("Description")).toHaveValue(
      "Everything about the relaunch",
    );
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

    serverDescription = "Changed in another tab";
    await chooseFromRowMenu(canvasElement, "Edit details");
    const second = await openedDialog("dialog", "Edit details");
    await expect(second.getByLabelText("Description")).toHaveValue(
      "Changed in another tab",
    );
    await expect(sentRoutes()).toEqual([
      "GET /api/v1/pins",
      "GET /api/v1/projects/p1",
      "GET /api/v1/projects/p1",
    ]);
  },
};

/**
 * Edit details opens at once on the pin's lean card; when the project's read
 * fails, the dialog says so instead of a form that could not be seeded.
 *
 * @summary pinned project menu: Edit details reports a failed read
 */
export const ProjectEditDetailsReadFails: Story = {
  tags: ["ai-generated"],
  parameters: { pins: [projectPin] },
  play: async ({ canvasElement }) => {
    serverDescription = undefined;
    await chooseFromRowMenu(canvasElement, "Edit details");
    const dialog = await openedDialog("dialog", "Edit details");
    await expect(await dialog.findByRole("alert")).toHaveTextContent(
      "Couldn't load this project's details",
    );
    await expect(dialog.queryByLabelText("Description")).toBeNull();
  },
};
