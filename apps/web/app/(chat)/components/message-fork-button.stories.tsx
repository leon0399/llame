import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, fn, userEvent, within } from "storybook/test";
import { vi } from "vitest";

// Import the hook via the REAL specifier: sb.mock (preview.tsx) redirects it
// to the __mocks__ module. The stable `forkMutate` control is imported from
// that manual mock and injected into the redirected hook in `beforeEach`.
import * as fork from "@/lib/services/chat/fork";
import { forkMutate } from "@/lib/services/chat/__mocks__/fork";
import { MessageForkButton } from "./message-fork-button";

const useForkChat = vi.mocked(fork.useForkChat, { partial: true });

function isFunction(value: unknown): value is (forked: { id: string }) => void {
  return typeof value === "function";
}

const meta = {
  component: MessageForkButton,
  tags: ["autodocs"],
  args: {
    chatId: "chat-1",
    fromMessageId: "msg-2",
    onForked: fn(),
  },
  beforeEach: () => {
    forkMutate.mockClear();
    useForkChat.mockReturnValue({ mutate: forkMutate, isPending: false });
  },
  parameters: { layout: "centered" },
} satisfies Meta<typeof MessageForkButton>;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * The always-visible fork-from-here affordance on a message (#141: a
 * persistent MessageActions row, not a hover-only floating icon) — clicking
 * it requests the fork with the chat + message id and navigates via onForked
 * when the mutation succeeds.
 *
 * @summary reachable fork affordance wired to the fork mutation
 */
export const Basic: Story = {
  tags: ["ai-generated"],
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    const button = canvas.getByRole("button", { name: /fork from here/i });
    await expect(button).toBeEnabled();

    await userEvent.click(button);
    await expect(forkMutate).toHaveBeenCalledTimes(1);
    // Direct call inspection instead of expect.any(Function): browser-mode
    // matchers instanceof-check against the wrong realm's Function.
    // SAFETY: MessageForkButton always calls `mutate` with these two
    // positional arguments — asserted immediately below by shape and type.
    const [variables, { onSuccess }] = forkMutate.mock.calls[0] as [
      { chatId: string; fromMessageId: string },
      { onSuccess: (forked: { id: string }) => void },
    ];
    await expect(variables).toEqual({
      chatId: "chat-1",
      fromMessageId: "msg-2",
    });
    await expect(isFunction(onSuccess)).toBe(true);

    // Driving the mutation's success navigates through onForked.
    onSuccess({ id: "forked-chat-9" });
    await expect(args.onForked).toHaveBeenCalledWith("forked-chat-9");
  },
};

/**
 * No double-submit: while a fork is in flight the button disables until the
 * mutation settles.
 *
 * @summary disabled while the fork mutation is pending
 */
export const Pending: Story = {
  tags: ["ai-generated"],
  // Runs after meta.beforeEach, so this override wins for this story only.
  beforeEach: () => {
    useForkChat.mockReturnValue({ mutate: forkMutate, isPending: true });
  },
  play: async ({ canvasElement }) => {
    await expect(
      within(canvasElement).getByRole("button", { name: /fork from here/i }),
    ).toBeDisabled();
  },
};
