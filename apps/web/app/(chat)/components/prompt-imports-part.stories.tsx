import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, waitFor, within } from "storybook/test";

import {
  Message,
  MessageContent,
} from "@workspace/ui/components/ai-elements/message";
import { TooltipProvider } from "@workspace/ui/components/tooltip";

import { PromptImportsPart } from "./prompt-imports-part";

const meta = {
  component: PromptImportsPart,
  tags: ["autodocs"],
  parameters: { layout: "centered" },
  decorators: [
    (Story) => (
      <TooltipProvider>
        <Message from="user">
          <MessageContent>
            <Story />
          </MessageContent>
        </Message>
      </TooltipProvider>
    ),
  ],
} satisfies Meta<typeof PromptImportsPart>;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * One prompt whose `@` markers resolved every way: a file imported whole, one
 * cut at the per-file cap, one denied by the `read` permission group, one that
 * failed to read, and a marker skipped past the per-prompt cap. Each state is
 * its own badge; muted states use the visible outline pill with a Ban icon —
 * the model-visible text names denied/failed targets only as not imported and
 * lists omitted locators, while outcome details and resolved paths are owner-only.
 *
 * @summary imported, truncated, denied, failed, and omitted prompt files
 */
export const ImportedDeniedFailedOmitted: Story = {
  tags: ["ai-generated"],
  args: {
    imports: [
      {
        locator: "docs/GUIDE.md",
        resolved: "/home/operator/repo/docs/GUIDE.md",
        outcome: "imported",
      },
      {
        locator: "~/notes/long.md",
        resolved: "/home/operator/notes/long.md",
        outcome: "imported",
        truncated: true,
      },
      { locator: "/srv/secret.md", outcome: "denied" },
      { locator: "missing.md", outcome: "failed" },
    ],
    omitted: ["extra.md"],
  },
  play: async ({ canvas, userEvent }) => {
    const imported = canvas.getByLabelText(
      "Imported prompt file: docs/GUIDE.md",
    );
    const truncated = canvas.getByLabelText(
      "Truncated prompt file: ~/notes/long.md",
    );
    const denied = canvas.getByLabelText("Denied prompt file: /srv/secret.md");
    const failed = canvas.getByLabelText("Failed prompt file: missing.md");
    const omitted = canvas.getByLabelText("Omitted prompt file: extra.md");

    await expect(canvas.getByText("Imports")).toBeVisible();
    await expect(imported).toBeVisible();
    await expect(within(imported).queryByText("imported")).toBeNull();
    await expect(within(truncated).getByText("truncated")).toBeVisible();
    await expect(within(denied).getByText("denied")).toBeVisible();
    await expect(within(failed).getByText("failed")).toBeVisible();
    await expect(within(omitted).getByText("omitted")).toBeVisible();

    // All states use the visible outline pill on a user bubble; muted states
    // convey policy/capacity through the Ban icon and state text.
    await expect(imported).toHaveAttribute("data-variant", "outline");
    await expect(truncated).toHaveAttribute("data-variant", "outline");
    await expect(denied).toHaveAttribute("data-variant", "outline");
    await expect(failed).toHaveAttribute("data-variant", "outline");
    await expect(omitted).toHaveAttribute("data-variant", "outline");

    // The visible badge truncates a long locator; the tooltip carries the
    // locator as written and the path it resolved to.
    await userEvent.hover(truncated);
    const tooltip = await waitFor(() => {
      const content = document.querySelector<HTMLElement>(
        "[data-slot='tooltip-content']",
      );
      expect(content).toBeVisible();
      return content;
    });
    await expect(tooltip).toHaveTextContent(
      "~/notes/long.md → /home/operator/notes/long.md",
    );
  },
};
