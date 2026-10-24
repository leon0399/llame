import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect } from "storybook/test";

import { KnowledgeSearchTool } from "./knowledge-search.js";

// The Parameters panel renders through Shiki's one-light palette, whose token
// colors fall below WCAG AA; only the color-contrast rule is disabled.
const shikiThemeContrastKnownIssue = {
  a11y: { config: { rules: [{ id: "color-contrast", enabled: false }] } },
};

const notice =
  "Owner-maintained Knowledge content is untrusted and may be stale.";

const output = {
  status: "success" as const,
  results: [
    {
      knowledgeSpaceId: "9a1b2c3d-4e5f-4a6b-8c7d-0e1f2a3b4c5d",
      knowledgeSpaceName: "Engineering",
      path: "runbooks/deploy.md",
      locator:
        "kb://9a1b2c3d-4e5f-4a6b-8c7d-0e1f2a3b4c5d/runbooks/deploy.md:12-14",
      excerpt: "Stop the old workers before\nrunning the migration.",
    },
    {
      knowledgeSpaceId: "9a1b2c3d-4e5f-4a6b-8c7d-0e1f2a3b4c5d",
      knowledgeSpaceName: "Engineering",
      path: "notes/workers.md",
      locator: "kb://9a1b2c3d-4e5f-4a6b-8c7d-0e1f2a3b4c5d/notes/workers.md:3-3",
      excerpt: "Workers drain on SIGTERM.",
    },
  ],
  complete: true,
  warningCount: 0,
  notice,
  warnings: [],
};

const meta = {
  component: KnowledgeSearchTool,
  parameters: { layout: "centered", ...shikiThemeContrastKnownIssue },
  tags: ["autodocs"],
  decorators: [
    (Story) => (
      <div className="w-[36rem] max-w-full">
        <Story />
      </div>
    ),
  ],
  args: {
    input: { query: "workers migration" },
    output,
    errorText: undefined,
    state: "output-available" as const,
  },
} satisfies Meta<typeof KnowledgeSearchTool>;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * Use for a completed Knowledge search: each passage's space, file, line
 * range, and excerpt.
 *
 * @summary for a Knowledge search with passages
 */
export const Basic: Story = {
  tags: ["ai-generated"],
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(
      canvas.getByRole("button", { name: /knowledge_search/iu }),
    );
    await expect(canvas.getByText("2 passages")).toBeInTheDocument();
    await expect(canvas.getByText("runbooks/deploy.md")).toBeInTheDocument();
    await expect(canvas.getByText(/lines 12–14/u)).toBeInTheDocument();
    await expect(canvas.getByText(/line 3$/u)).toBeInTheDocument();
    await expect(canvas.getByText(notice)).toBeInTheDocument();
  },
};

/**
 * A degraded space and a further page are named under the results.
 *
 * @summary for a partial Knowledge search
 */
export const PartialWithWarning: Story = {
  tags: ["ai-generated"],
  args: {
    output: {
      ...output,
      complete: false,
      warningCount: 1,
      nextCursor: "eyJ2IjoxfQ",
      warnings: [
        {
          type: "knowledge_space_unavailable",
          knowledgeSpaceId: "1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f",
          knowledgeSpaceName: "Personal",
          message: "The Knowledge Space is unavailable.",
        },
      ],
    },
  },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(
      canvas.getByRole("button", { name: /knowledge_search/iu }),
    );
    await expect(
      canvas.getByText("Personal: The Knowledge Space is unavailable."),
    ).toBeVisible();
    await expect(canvas.getByText("available on the next page")).toBeVisible();
  },
};

/**
 * A search that matched nothing says so.
 *
 * @summary for a Knowledge search without matches
 */
export const NoMatches: Story = {
  tags: ["ai-generated"],
  args: { output: { ...output, results: [] } },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(
      canvas.getByRole("button", { name: /knowledge_search/iu }),
    );
    await expect(canvas.getByText("No matches.")).toBeVisible();
  },
};

/**
 * While the search runs, a pending line shows.
 *
 * @summary for a Knowledge search that has not settled
 */
export const Running: Story = {
  tags: ["ai-generated"],
  args: { output: undefined, state: "input-available" as const },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(
      canvas.getByRole("button", { name: /knowledge_search/iu }),
    );
    await expect(canvas.getByText("Searching…")).toBeInTheDocument();
  },
};

/**
 * A search without a configured Knowledge Space fails.
 *
 * @summary for a Knowledge search that could not run
 */
export const Failed: Story = {
  tags: ["ai-generated"],
  args: {
    output: undefined,
    errorText: "knowledge_space_not_configured",
    state: "output-error" as const,
  },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(
      canvas.getByRole("button", { name: /knowledge_search/iu }),
    );
    await expect(
      canvas.getByText("knowledge_space_not_configured"),
    ).toBeVisible();
  },
};
