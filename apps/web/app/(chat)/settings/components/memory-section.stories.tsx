import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, userEvent, within } from "storybook/test";
import { vi } from "vitest";

// Import through the real specifiers: sb.mock redirects these to their
// controllable mocks, so the component and these stories use the same hooks.
import * as memoryMutations from "@/lib/services/memory/mutations";
import { updateMemoryMutate } from "@/lib/services/memory/__mocks__/mutations";
import * as memoryQueries from "@/lib/services/memory/queries";
import { refetchMemory } from "@/lib/services/memory/__mocks__/queries";
import { MemorySection } from "./memory-section";

const useMemoryQuery = vi.mocked(memoryQueries.useMemoryQuery, {
  partial: true,
});
const useUpdateMemoryMutation = vi.mocked(
  memoryMutations.useUpdateMemoryMutation,
  { partial: true },
);

const meta = {
  component: MemorySection,
  tags: ["autodocs"],
  beforeEach: () => {
    useMemoryQuery.mockReturnValue({
      data: { shareRecentChats: false },
      isPending: false,
      isError: false,
      refetch: refetchMemory,
    });
    useUpdateMemoryMutation.mockReturnValue({
      isError: false,
      mutate: updateMemoryMutate,
    });
    updateMemoryMutate.mockClear();
    refetchMemory.mockClear();
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
      isError: false,
      refetch: refetchMemory,
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
      isError: false,
      refetch: refetchMemory,
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

/**
 * A failed settings read must not present as perpetual loading. React Query
 * leaves `isPending` false with no data once the query errors, so the owner
 * would otherwise watch a skeleton forever — and the switch lives inside that
 * branch, which would make a privacy control unreachable until a full reload.
 *
 * @summary failed settings load, with a retry path
 */
export const LoadFailed: Story = {
  tags: ["ai-generated"],
  beforeEach: () => {
    useMemoryQuery.mockReturnValue({
      data: undefined,
      isPending: false,
      isError: true,
      refetch: refetchMemory,
    });
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    // Announced, not merely present: this text arrives after the skeleton has
    // rendered, so without an alert role a screen reader is never told.
    await expect(canvas.getByRole("alert")).toHaveTextContent(
      "Could not load your memory settings.",
    );
    // Not a skeleton, and not silence.
    await expect(
      canvasElement.querySelector('[data-slot="skeleton"]'),
    ).toBeNull();

    await userEvent.click(canvas.getByRole("button", { name: "Try again" }));
    await expect(refetchMemory).toHaveBeenCalled();
  },
};
