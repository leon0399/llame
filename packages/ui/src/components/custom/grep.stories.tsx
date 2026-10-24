import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, within } from "storybook/test";

import { contrastKnownIssue232 } from "../known-a11y-issues.js";
import { GrepTool } from "./grep.js";

const output = {
  status: "success" as const,
  results: [
    {
      locator: "apps/api/src/tools/grep.ts:57-59",
      content:
        "57: \n58: export const grepInputSchema = z.strictObject({\n59:   patterns: z.array(z.string()),\n",
      matches: [58],
    },
    {
      locator: "apps/api/src/tools/grep.ts:120-122",
      content:
        "120: }\n121: const parsed = grepInputSchema.parse(args);\n122: \n",
      matches: [121],
    },
    {
      locator: "apps/api/src/tools/registry.ts:3-3",
      content: "3: import { grepInputSchema } from './grep';\n",
      matches: [3],
    },
  ],
  complete: true,
  warnings: [],
};

const meta = {
  component: GrepTool,
  parameters: { layout: "centered" },
  tags: ["autodocs"],
  decorators: [
    (Story) => (
      <div className="w-[36rem] max-w-full">
        <Story />
      </div>
    ),
  ],
  args: {
    input: { patterns: ["grepInputSchema"], scopes: ["apps/api/src"] },
    output,
    errorText: undefined,
    state: "output-available" as const,
  },
} satisfies Meta<typeof GrepTool>;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * Use for a completed search: the patterns and scope, then each file's
 * passages with real line numbers, a gap between non-adjacent passages, and
 * the matching lines emphasized.
 *
 * @summary for a search with matches in several files
 */
export const Basic: Story = {
  tags: ["ai-generated"],
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole("button", { name: /grep/iu }));
    await expect(canvas.getByText("3 in 2 files")).toBeInTheDocument();
    await expect(canvas.getByText("in apps/api/src")).toBeInTheDocument();
    const file = canvas.getByRole("group", {
      name: "Matches in apps/api/src/tools/grep.ts",
    });
    await expect(file).toHaveTextContent("const parsed");
    await expect(file).not.toHaveTextContent("121: const");
    await expect(within(file).getByText("⋯")).toBeInTheDocument();
    await expect(file.querySelector('[data-line="121"]')).toHaveClass(
      "font-medium",
    );
    await expect(file.querySelector('[data-line="120"]')).not.toHaveClass(
      "font-medium",
    );
  },
};

/**
 * A search that found nothing says so.
 *
 * @summary for a search without matches
 */
export const NoMatches: Story = {
  tags: ["ai-generated"],
  args: { output: { ...output, results: [] } },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole("button", { name: /grep/iu }));
    await expect(canvas.getByText("No matches.")).toBeInTheDocument();
  },
};

/**
 * A bounded page names the continuation and every skipped-entry warning,
 * and marks the literal, case-insensitive mode.
 *
 * @summary for an incomplete page with warnings
 */
export const IncompleteWithWarnings: Story = {
  tags: ["ai-generated"],
  args: {
    input: { patterns: ["TODO("], literal: true, ignoreCase: true },
    output: {
      ...output,
      complete: false,
      cursor: "eyJ2IjoxfQ",
      warnings: [
        { kind: "binary", count: 2 },
        { kind: "deadline", count: 1 },
      ],
    },
  },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole("button", { name: /grep/iu }));
    await expect(canvas.getByText("literal · ignore case")).toBeVisible();
    await expect(canvas.getByText("in the Workspace")).toBeVisible();
    await expect(canvas.getByText("available on the next page")).toBeVisible();
    await expect(canvas.getByText("binary files skipped (2)")).toBeVisible();
    await expect(canvas.queryByText(/eyJ2/u)).not.toBeInTheDocument();
  },
};

/**
 * While the search runs, the query shows with a pending line.
 *
 * @summary for a search that has not settled
 */
export const Running: Story = {
  tags: ["ai-generated"],
  args: { output: undefined, state: "input-available" as const },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole("button", { name: /grep/iu }));
    await expect(canvas.getByText("Searching…")).toBeInTheDocument();
  },
};

/**
 * An invalid pattern fails the whole call.
 *
 * @summary for a search whose pattern does not compile
 */
export const Failed: Story = {
  tags: ["ai-generated"],
  // #232: the destructive error panel's token pairing fails color-contrast.
  parameters: contrastKnownIssue232,
  args: {
    input: { patterns: ["(unclosed"] },
    output: undefined,
    errorText: "Pattern 1: unclosed group",
    state: "output-error" as const,
  },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole("button", { name: /grep/iu }));
    await expect(canvas.getByText("Pattern 1: unclosed group")).toBeVisible();
  },
};
