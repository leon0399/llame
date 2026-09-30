import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, waitFor, within } from "storybook/test";

import { TooltipProvider } from "@workspace/ui/components/tooltip";

import { InstructionsPart } from "./instructions-part";

const meta = {
  component: InstructionsPart,
  tags: ["autodocs"],
  parameters: { layout: "centered" },
  decorators: [
    (Story) => (
      <TooltipProvider>
        <Story />
      </TooltipProvider>
    ),
  ],
} satisfies Meta<typeof InstructionsPart>;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * One in-Run bundle: the chip names every loaded path in the api's directory
 * order, marks the file that was cut at the per-file cap, and keeps the
 * denied path muted rather than destructive (design D9) — the model-visible
 * text never names a denied path, and only the owner sees this metadata.
 *
 * @summary loaded, truncated, and denied instruction files
 */
export const LoadedTruncatedDenied: Story = {
  tags: ["ai-generated"],
  args: {
    files: [
      {
        path: "/home/operator/repo/AGENTS.md",
        canonicalPath: "/home/operator/repo/AGENTS.md",
        truncated: false,
      },
      {
        path: "/home/operator/repo/apps/api/AGENTS.md",
        canonicalPath: "/home/operator/dotfiles/AGENTS.md",
        truncated: true,
      },
    ],
    denied: ["/srv/AGENTS.md"],
  },
  play: async ({ canvas, userEvent }) => {
    const loaded = canvas.getByLabelText(
      "Loaded instruction file: /home/operator/repo/AGENTS.md",
    );
    const truncated = canvas.getByLabelText(
      "Truncated instruction file: /home/operator/repo/apps/api/AGENTS.md",
    );
    const denied = canvas.getByLabelText(
      "Denied instruction file: /srv/AGENTS.md",
    );

    await expect(loaded).toBeVisible();
    await expect(truncated).toBeVisible();
    await expect(denied).toBeVisible();
    await expect(canvas.getByText("Instructions")).toBeVisible();
    await expect(within(loaded).queryByText("truncated")).toBeNull();
    await expect(within(truncated).getByText("truncated")).toBeVisible();
    await expect(within(denied).getByText("denied")).toBeVisible();

    // A denial is policy state, not a destructive one: the muted `secondary`
    // surface leaves Alert Red reserved for destructive states (DESIGN.md §10).
    await expect(denied).toHaveAttribute("data-variant", "secondary");
    await expect(truncated).toHaveAttribute("data-variant", "outline");

    // The visible badge truncates a long path; the tooltip carries the
    // selected path and, for a symlinked candidate, the canonical target.
    await userEvent.hover(truncated);
    const tooltip = await waitFor(() => {
      const content = document.querySelector<HTMLElement>(
        "[data-slot='tooltip-content']",
      );
      expect(content).toBeVisible();
      return content;
    });
    await expect(tooltip).toHaveTextContent(
      "/home/operator/repo/apps/api/AGENTS.md → /home/operator/dotfiles/AGENTS.md",
    );
  },
};
