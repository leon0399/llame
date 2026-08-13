import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, userEvent, within } from "storybook/test";

// Import through the real specifiers: sb.mock redirects these to their
// controllable mocks, so the component and these stories use the same hooks.
import * as memoryMutations from "@/lib/services/memory/mutations";
import type * as memoryMutationsMock from "@/lib/services/memory/__mocks__/mutations";
import * as memoryQueries from "@/lib/services/memory/queries";
import type * as memoryQueriesMock from "@/lib/services/memory/__mocks__/queries";
import { MemorySection } from "./memory-section";

const { useMemoryQuery } = memoryQueries as unknown as typeof memoryQueriesMock;
const { updateMemoryMutate, useUpdateMemoryMutation } =
  memoryMutations as unknown as typeof memoryMutationsMock;

const meta = {
  component: MemorySection,
  tags: ["autodocs"],
  beforeEach: () => {
    useMemoryQuery.mockReturnValue({
      data: { shareRecentChats: false },
      isPending: false,
    });
    useUpdateMemoryMutation.mockReturnValue({
      isError: false,
      mutate: updateMemoryMutate,
    });
    updateMemoryMutate.mockClear();
  },
  parameters: { layout: "centered" },
} satisfies Meta<typeof MemorySection>;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * The default, opt-out state: the switch is visibly unchecked and the full
 * consent contract stays readable beside the decision it qualifies.
 *
 * @summary off-by-default memory sharing with complete consent disclosure
 */
export const Off: Story = {
  tags: ["ai-generated"],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(
      canvas.getByRole("switch", { name: "Share my recent chats" }),
    ).not.toBeChecked();
    await expect(
      canvas.getByText(
        "Enabling applies to your whole existing corpus, including chats and opening excerpts created before you opt in.",
      ),
    ).toBeInTheDocument();
    await expect(
      canvas.getByText(
        "Turning it off stops new baselines, re-bakes, and appends, but chats that already have a baseline keep sending it.",
      ),
    ).toBeInTheDocument();
    await expect(
      canvas.getByText(
        "Deleting a chat does not erase its title and excerpt from other chats' already-bound prompts, persisted appends, or receipts already issued.",
      ),
    ).toBeInTheDocument();
  },
};

/**
 * An owner who has explicitly opted in sees the same disclosure and a checked
 * switch when the settings query resolves true.
 *
 * @summary enabled memory sharing
 */
export const On: Story = {
  tags: ["ai-generated"],
  beforeEach: () => {
    useMemoryQuery.mockReturnValue({
      data: { shareRecentChats: true },
      isPending: false,
    });
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(
      canvas.getByRole("switch", { name: "Share my recent chats" }),
    ).toBeChecked();
  },
};

/**
 * Toggling the default state requests the independently computed next value.
 *
 * @summary enabling sends the flipped setting value
 */
export const EnablesSharing: Story = {
  tags: ["ai-generated"],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await userEvent.click(
      canvas.getByRole("switch", { name: "Share my recent chats" }),
    );

    await expect(updateMemoryMutate).toHaveBeenCalledWith({
      shareRecentChats: true,
    });
  },
};

/**
 * The real card header remains in place while the query is unresolved; an
 * indeterminate switch would misrepresent a privacy setting.
 *
 * @summary loading memory settings without a switch
 */
export const Loading: Story = {
  tags: ["ai-generated"],
  beforeEach: () => {
    useMemoryQuery.mockReturnValue({
      data: undefined,
      isPending: true,
    });
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByText("Memory")).toBeInTheDocument();
    await expect(
      canvasElement.querySelector('[data-slot="skeleton"]'),
    ).not.toBeNull();
    await expect(
      canvas.queryByRole("switch", { name: "Share my recent chats" }),
    ).toBeNull();
  },
};
