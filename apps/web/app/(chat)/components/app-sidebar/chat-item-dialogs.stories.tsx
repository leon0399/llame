import type { ComponentProps } from "react";
import { useState } from "react";

import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, fn, screen, userEvent, waitFor, within } from "storybook/test";
import { vi, type Mock } from "vitest";

import { Button } from "@workspace/ui/components/button";
import { contrastKnownIssue232 } from "@workspace/ui/components/known-a11y-issues";

import {
  emptyResponse,
  requestFromCall,
  stubFetch,
} from "@/lib/test-support/fetch-stub";
import { DeleteChatDialog, RenameChatDialog } from "./chat-item-dialogs";

// No hook mocking: the real useRenameChat and useDeleteChat run against a
// stubbed globalThis.fetch. The rename PATCH succeeds at once; the DELETE is
// held until a story releases it, so the active-chat story can observe the
// navigation while the request is still in flight. An unrouted request fails
// the story.
let fetchMock: Mock<typeof fetch>;
let releaseDelete: () => void;

// The delete dialog navigates through the router. nextjs-vite provides
// `useRouter()` from the story's own `nextjs.router` parameter, so the delete
// stories hand the framework this spy and then assert the destination.
const routerPush = fn().mockName("router.push");

function routeFetch() {
  return () => {
    routerPush.mockClear();
    fetchMock = stubFetch();
    fetchMock.mockImplementation((input) => {
      const request = input instanceof Request ? input : new Request(input);
      const key = `${request.method} ${new URL(request.url).pathname}`;
      if (key === "PATCH /api/v1/chats/c1") {
        return Promise.resolve(emptyResponse());
      }
      if (key === "DELETE /api/v1/chats/c1") {
        return new Promise<Response>((resolve) => {
          releaseDelete = () => resolve(emptyResponse());
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
async function openedDialog(role: "dialog" | "alertdialog", name: string) {
  // The dialog portals into document.body, outside the story canvas.
  const dialog = await screen.findByRole(role, { name });
  await waitFor(() => expect(dialog).toBeVisible());
  return within(dialog);
}

/** The single request the dialog sent, once it has been sent. */
async function sentRequest() {
  const request = await waitFor(() => requestFromCall(fetchMock));
  await expect(fetchMock).toHaveBeenCalledTimes(1);
  await expect(new URL(request.url).pathname).toBe("/api/v1/chats/c1");
  return request;
}

const meta = {
  component: RenameChatDialog,
  subcomponents: { DeleteChatDialog },
  tags: ["autodocs"],
  args: {
    chat: { id: "c1", title: "Trip to Lisbon" },
    open: true,
    onOpenChange: fn(),
  },
  beforeEach: routeFetch(),
} satisfies Meta<typeof RenameChatDialog>;

export default meta;
type Story = StoryObj<typeof meta>;
type DeleteStory = StoryObj<typeof DeleteChatDialog>;

/**
 * Saving the title unchanged just closes the dialog; nothing is sent.
 *
 * @summary rename: Save with the same title closes without a request
 */
export const RenameUnchanged: Story = {
  tags: ["ai-generated"],
  play: async ({ args }) => {
    const dialog = await openedDialog("dialog", "Rename chat");
    await expect(dialog.getByLabelText("Chat title")).toHaveValue(
      "Trip to Lisbon",
    );

    await userEvent.click(dialog.getByRole("button", { name: "Save" }));

    await expect(args.onOpenChange).toHaveBeenCalledWith(false);
    await expect(fetchMock).not.toHaveBeenCalled();
  },
};

/**
 * Saving a new title PATCHes the chat with it and closes the dialog once the
 * server accepts it.
 *
 * @summary rename: Save with a new title sends it and closes on success
 */
export const RenameChanged: Story = {
  tags: ["ai-generated"],
  play: async ({ args }) => {
    const dialog = await openedDialog("dialog", "Rename chat");
    const field = dialog.getByLabelText("Chat title");

    await userEvent.clear(field);
    await userEvent.type(field, "Trip to Porto");
    await userEvent.click(dialog.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(args.onOpenChange).toHaveBeenCalledWith(false));
    const request = await sentRequest();
    await expect(request.method).toBe("PATCH");
    await expect(request.clone().json()).resolves.toEqual({
      title: "Trip to Porto",
    });
  },
};

/**
 * Stands in for the sidebar row that owns the dialog: it opens the dialog from
 * a Rename button, and "Rename in another tab" replaces the chat's title the
 * way a sidebar refetch does after the chat was renamed elsewhere.
 */
function RenameFromSidebar({ chat }: ComponentProps<typeof RenameChatDialog>) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState(chat.title);
  return (
    <>
      <Button onClick={() => setOpen(true)}>Rename</Button>
      <Button variant="outline" onClick={() => setTitle("Updated elsewhere")}>
        Rename in another tab
      </Button>
      <RenameChatDialog
        chat={{ ...chat, title }}
        open={open}
        onOpenChange={setOpen}
      />
    </>
  );
}

/**
 * Each time the dialog opens, the field starts from the chat's current title:
 * a cancelled draft is gone, and a title changed while the dialog was closed
 * shows up.
 *
 * @summary rename: reopening starts from the chat's current title
 */
export const RenameReopen: Story = {
  tags: ["ai-generated"],
  render: (args) => <RenameFromSidebar {...args} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await userEvent.click(canvas.getByRole("button", { name: "Rename" }));
    let dialog = await openedDialog("dialog", "Rename chat");
    await userEvent.clear(dialog.getByLabelText("Chat title"));
    await userEvent.type(dialog.getByLabelText("Chat title"), "Draft");
    await userEvent.click(dialog.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

    await userEvent.click(
      canvas.getByRole("button", { name: "Rename in another tab" }),
    );
    await userEvent.click(canvas.getByRole("button", { name: "Rename" }));

    dialog = await openedDialog("dialog", "Rename chat");
    await expect(dialog.getByLabelText("Chat title")).toHaveValue(
      "Updated elsewhere",
    );
    await expect(fetchMock).not.toHaveBeenCalled();
  },
};

// #232 — the confirm button is base-nova's subtle destructive Button
// (`bg-destructive/10 text-destructive`, ~3.82:1), the tracked low-contrast
// token defect. Suppress only color-contrast until the token fix lands. The
// router spy makes the delete dialog's navigation observable.
const deleteParameters = {
  ...contrastKnownIssue232,
  nextjs: { router: { push: routerPush } },
};

/**
 * Deleting the chat that is open navigates home at once, while the DELETE is
 * still in flight (Delete stays disabled meanwhile), so the chat's page is
 * gone before the chat is. The dialog closes once the DELETE lands.
 *
 * @summary delete the open chat: goes home first, closes when deleted
 */
export const DeleteActive: DeleteStory = {
  tags: ["ai-generated"],
  args: { isActive: true },
  parameters: deleteParameters,
  render: (args) => <DeleteChatDialog {...args} />,
  play: async ({ args }) => {
    const dialog = await openedDialog("alertdialog", "Delete chat?");
    const confirm = dialog.getByRole("button", { name: "Delete" });

    await userEvent.click(confirm);

    await waitFor(() => expect(routerPush).toHaveBeenCalledWith("/"));
    const request = await sentRequest();
    await expect(request.method).toBe("DELETE");
    await waitFor(() => expect(confirm).toBeDisabled());
    await expect(args.onOpenChange).not.toHaveBeenCalled();

    releaseDelete();

    await waitFor(() => expect(args.onOpenChange).toHaveBeenCalledWith(false));
    await expect(routerPush).toHaveBeenCalledTimes(1);
  },
};

/**
 * Deleting a chat that is not the open one deletes it and closes the dialog
 * without navigating anywhere.
 *
 * @summary delete another chat: never navigates
 */
export const DeleteInactive: DeleteStory = {
  tags: ["ai-generated"],
  args: { isActive: false },
  parameters: deleteParameters,
  render: (args) => <DeleteChatDialog {...args} />,
  play: async ({ args }) => {
    const dialog = await openedDialog("alertdialog", "Delete chat?");

    await userEvent.click(dialog.getByRole("button", { name: "Delete" }));

    const request = await sentRequest();
    await expect(request.method).toBe("DELETE");
    releaseDelete();
    await waitFor(() => expect(args.onOpenChange).toHaveBeenCalledWith(false));
    await expect(routerPush).not.toHaveBeenCalled();
  },
};
