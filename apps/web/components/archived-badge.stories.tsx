import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { contrastKnownIssue232 } from "@workspace/ui/components/known-a11y-issues";

import { ArchivedBadge } from "./archived-badge";

const meta = {
  component: ArchivedBadge,
  tags: ["autodocs"],
  parameters: {
    layout: "centered",
    // #232 — muted-foreground on the secondary pill surface is ~4.34:1, the
    // tracked low-contrast token defect. Suppress only color-contrast until the
    // token fix lands.
    ...contrastKnownIssue232,
  },
} satisfies Meta<typeof ArchivedBadge>;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * The archived marker shown beside a chat or project title on archived rows
 * (chat list, project list, and the pinned rail). It is a small, muted
 * `secondary` pill composed from the shared Badge.
 *
 * @summary the Archived pill
 */
export const Basic: Story = { tags: ["ai-generated"] };
