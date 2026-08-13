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
 * The default, opt-out state: the switch is visibly unchecked, and the two-line
 * description names the destination the label cannot imply.
 *
 * @summary off-by-default memory sharing
 */
export const Off: Story = {
  tags: ["ai-generated"],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(
      canvas.getByRole("switch", { name: "Share my recent chats" }),
    ).not.toBeChecked();

    // The card states what is sent, where it goes, and the default. The rest
    // of the consent contract lives in README.md — pin the destination here,
    // because it is the one fact the label cannot imply and the owner cannot
    // infer from a switch.
    await expect(
      canvasElement.querySelector('[data-slot="field-description"]'),
    ).toHaveTextContent(
      "Sends titles and opening excerpts from your other chats to this instance's model provider, which may be a third party. Off by default.",
    );
  },
};

/**
 * An owner who has explicitly opted in: the settings query resolves true and
 * the switch reflects it.
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
