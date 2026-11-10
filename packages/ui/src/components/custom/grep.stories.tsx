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

const pass = (locator: string, line: number, text: string) => ({
  locator,
  content: `${line}: ${text}\n`,
  matches: [line],
});

const rerank = {
  model: "jev-1.14",
  order: ["p2", "p0", "p1"],
  scores: { p2: 0.81, p0: 0.4, p1: 0.05 },
  latencyMs: 530,
  costUsd: 0.0037,
  runLengths: [1, 2, 1],
};

const rankedOutput = {
  ...output,
  results: [
    pass("src/c.ts:5-5", 5, "needle c"),
    pass("src/a.ts:10-10", 10, "needle a1"),
    pass("src/a.ts:30-30", 30, "needle a2"),
    pass("src/b.ts:2-2", 2, "needle b"),
  ],
  display: { rerank },
};

/**
 * A ranked call shows one badge with the served model, latency, and cost; each
 * run shows its ordinal, original key, and score beside its file line.
 *
 * @summary for a ranked search
 */
export const Ranked: Story = {
  tags: ["ai-generated"],
  args: { output: rankedOutput },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole("button", { name: /grep/iu }));
    await expect(canvas.getByText("Ranked by jev-1.14")).toBeVisible();
    await expect(canvas.getByText("· 530 ms · $0.0037")).toBeVisible();
    await expect(canvas.getByText("#1 · p2 · score 0.81")).toBeVisible();
    await expect(canvas.getByText("#2 · p0 · score 0.40")).toBeVisible();
    await expect(canvas.getByText("#3 · p1 · score 0.05")).toBeVisible();
  },
};

/**
 * Only judged runs show a score; an unjudged run follows with none.
 *
 * @summary for a partly judged ranking
 */
export const RankedPartial: Story = {
  tags: ["ai-generated"],
  args: {
    output: {
      ...rankedOutput,
      display: { rerank: { ...rerank, scores: { p2: 0.81 } } },
    },
  },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole("button", { name: /grep/iu }));
    await expect(canvas.getAllByText(/score/u)).toHaveLength(1);
  },
};

/**
 * A failed rank call keeps walk order and shows the framing line, with no
 * badge and no score.
 *
 * @summary for a search whose rank call failed
 */
export const RankUnavailable: Story = {
  tags: ["ai-generated"],
  args: { output: { ...output, ranking: "unavailable" } },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole("button", { name: /grep/iu }));
    await expect(
      canvas.getByText(/\[ranking unavailable; walk order\]/u),
    ).toBeVisible();
    await expect(canvas.queryByText(/Ranked by/u)).not.toBeInTheDocument();
    await expect(canvas.queryByText(/score/u)).not.toBeInTheDocument();
  },
};

/**
 * A part without a record shows no badge and no score.
 *
 * @summary for a search that was not ranked
 */
export const RankAbsent: Story = {
  tags: ["ai-generated"],
  args: { output },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole("button", { name: /grep/iu }));
    await expect(canvas.queryByText(/Ranked by/u)).not.toBeInTheDocument();
    await expect(canvas.queryByText(/score/u)).not.toBeInTheDocument();
  },
};

/**
 * The record judges three runs, but the part holds one; only that run shows
 * its score and no row appears for an omitted run.
 *
 * @summary for a record with more judged runs than rows
 */
export const RankedOmittedRows: Story = {
  tags: ["ai-generated"],
  args: {
    output: {
      ...rankedOutput,
      results: rankedOutput.results.slice(0, 1),
      display: { rerank },
    },
  },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole("button", { name: /grep/iu }));
    await expect(canvas.getAllByText(/score/u)).toHaveLength(1);
    await expect(canvas.getAllByRole("group")).toHaveLength(1);
  },
};

/**
 * A reorder can place two runs of one file side by side, the later run
 * starting after the earlier. Explicit run lengths keep them separate, each
 * with its own key and score.
 *
 * @summary for same-file runs with increasing start lines after a reorder
 */
export const SameFileRunsAfterReorder: Story = {
  tags: ["ai-generated"],
  args: {
    output: {
      ...output,
      results: [
        pass("src/a.ts:10-10", 10, "first run"),
        pass("src/a.ts:30-30", 30, "second run"),
      ],
      display: {
        rerank: {
          ...rerank,
          order: ["p1", "p0"],
          scores: { p1: 0.9, p0: 0.3 },
          runLengths: [1, 1],
        },
      },
    },
  },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole("button", { name: /grep/iu }));

    const groups = canvas.getAllByRole("group", {
      name: "Matches in src/a.ts",
    });

    await expect(groups).toHaveLength(2);
    await expect(groups[0]?.closest("li")).toContainElement(
      canvas.getByText("#1 · p1 · score 0.90"),
    );
    await expect(groups[1]?.closest("li")).toContainElement(
      canvas.getByText("#2 · p0 · score 0.30"),
    );
  },
};

/**
 * The inline part cut the final run: it holds fewer passages than its stored
 * length, and still shows as one run with its own score.
 *
 * @summary for a final run cut by the inline part
 */
export const TruncatedFinalRun: Story = {
  tags: ["ai-generated"],
  args: {
    output: {
      ...output,
      results: [
        pass("src/a.ts:10-10", 10, "needle a1"),
        pass("src/a.ts:30-30", 30, "needle a2"),
      ],
      display: { rerank: { ...rerank, runLengths: [1, 3] } },
    },
  },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole("button", { name: /grep/iu }));

    const groups = canvas.getAllByRole("group", {
      name: "Matches in src/a.ts",
    });

    await expect(groups).toHaveLength(2);
    await expect(groups[1]?.closest("li")).toContainElement(
      canvas.getByText("#2 · p0 · score 0.40"),
    );
  },
};

/**
 * The call's `objective` shows with its parameters.
 *
 * @summary for a search that states an objective
 */
export const WithObjective: Story = {
  tags: ["ai-generated"],
  args: {
    input: {
      patterns: ["grepInputSchema"],
      objective: "Find where the grep input schema is defined",
    },
  },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole("button", { name: /grep/iu }));
    await expect(
      canvas.getByText(/Find where the grep input schema is defined/u),
    ).toBeVisible();
  },
};
