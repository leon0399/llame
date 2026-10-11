import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, fn, screen, userEvent, waitFor, within } from "storybook/test";
import { vi, type Mock } from "vitest";

import { requestFromCall, stubFetch } from "@/lib/test-support/fetch-stub";
import { ShareChatDialog } from "./share-chat-dialog";

// No hook mocking: the real useSetChatVisibility runs against a stubbed
// globalThis.fetch. Only the visibility PATCH is routed, and it never
// settles, so a story observes the dialog while the toggle is in flight. An
// unrouted request fails the story.
let fetchMock: Mock<typeof fetch>;

function routeFetch() {
  return () => {
    fetchMock = stubFetch();
    fetchMock.mockImplementation((input) => {
      const request = input instanceof Request ? input : new Request(input);
      const key = `${request.method} ${new URL(request.url).pathname}`;
      if (key === "PATCH /api/v1/chats/c1") {
        return new Promise<Response>(() => {});
      }
      throw new Error(`unrouted fetch in story: ${key}`);
    });
    return () => {
      vi.unstubAllGlobals();
    };
  };
}

/** Wait for the dialog to finish fading in and return it. */
async function openedDialog() {
  // The dialog portals into document.body, outside the story canvas.
  const dialog = await screen.findByRole("dialog", { name: "Share chat" });
  await waitFor(() => expect(dialog).toBeVisible());
  return within(dialog);
}

/** The PATCH body the toggle sent, once it has been sent. */
async function sentVisibility() {
  const request = await waitFor(() => requestFromCall(fetchMock));
  await expect(request.method).toBe("PATCH");
  await expect(new URL(request.url).pathname).toBe("/api/v1/chats/c1");
  return request.clone().json();
}

const meta = {
  component: ShareChatDialog,
  tags: ["autodocs"],
  args: {
    chat: { id: "c1", visibility: "private" },
    open: true,
    onOpenChange: fn(),
  },
  beforeEach: routeFetch(),
} satisfies Meta<typeof ShareChatDialog>;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * A private chat shows the switch off and no share link. Done closes the
 * dialog.
 *
 * @summary private: switch off, no link, Done closes
 */
export const Private: Story = {
  tags: ["ai-generated"],
  play: async ({ args }) => {
    const dialog = await openedDialog();
    await expect(
      dialog.getByRole("switch", { name: "Share publicly" }),
    ).not.toBeChecked();
    await expect(dialog.queryByLabelText("Share link")).toBeNull();

    await userEvent.click(dialog.getByRole("button", { name: "Done" }));
    await expect(args.onOpenChange).toHaveBeenCalledWith(false);
    await expect(fetchMock).not.toHaveBeenCalled();
  },
};

/**
 * Turning sharing on sends the PATCH and, while it is still in flight, already
 * shows the switch on (locked until it settles) and the chat's absolute share
 * link. The switch does not snap back to the stale private prop.
 *
 * @summary turning sharing on shows the link while the request is pending
 */
export const MakePublic: Story = {
  tags: ["ai-generated"],
  play: async () => {
    const dialog = await openedDialog();
    const toggle = dialog.getByRole("switch", { name: "Share publicly" });

    await userEvent.click(toggle);

    await waitFor(() => expect(toggle).toBeChecked());
    await expect(toggle).toHaveAttribute("aria-disabled", "true");
    await expect(dialog.getByLabelText("Share link")).toHaveValue(
      `${window.location.origin}/shared/c1`,
    );
    await expect(sentVisibility()).resolves.toEqual({ visibility: "public" });
  },
};

/**
 * Turning sharing off for a public chat hides the share link while the PATCH
 * is still pending.
 *
 * @summary turning sharing off hides the link while the request is pending
 */
export const MakePrivate: Story = {
  tags: ["ai-generated"],
  args: { chat: { id: "c1", visibility: "public" } },
  play: async () => {
    const dialog = await openedDialog();
    const toggle = dialog.getByRole("switch", { name: "Share publicly" });
    await expect(toggle).toBeChecked();
    await expect(dialog.getByLabelText("Share link")).toBeVisible();

    await userEvent.click(toggle);

    await waitFor(() => expect(toggle).not.toBeChecked());
    await expect(dialog.queryByLabelText("Share link")).toBeNull();
    await expect(sentVisibility()).resolves.toEqual({ visibility: "private" });
  },
};

// Reading the real clipboard back needs a clipboard-read permission grant the
// headless runner does not give, so the copy story swaps in a writeText spy
// for its duration and asserts what was written.
const writeText = fn<(text: string) => Promise<void>>();

/**
 * Copy link writes the chat's absolute share link to the clipboard.
 *
 * @summary Copy link copies the share link
 */
export const CopyLink: Story = {
  tags: ["ai-generated"],
  args: { chat: { id: "c1", visibility: "public" } },
  beforeEach: () => {
    writeText.mockReset().mockResolvedValue(undefined);
    const original = Object.getOwnPropertyDescriptor(navigator, "clipboard");
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    return () => {
      if (original) {
        Object.defineProperty(navigator, "clipboard", original);
      } else {
        Reflect.deleteProperty(navigator, "clipboard");
      }
    };
  },
  play: async () => {
    const dialog = await openedDialog();

    await userEvent.click(dialog.getByRole("button", { name: "Copy link" }));

    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith(
        `${window.location.origin}/shared/c1`,
      ),
    );
  },
};
