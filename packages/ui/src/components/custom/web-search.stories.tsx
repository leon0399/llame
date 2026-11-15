import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect } from "storybook/test";

import { MessageResponse } from "@workspace/ui/components/ai-elements/message-response";

import { WebSearchTool, type WebSearchToolProps } from "./web-search.js";

const markdownRenderer: WebSearchToolProps["Markdown"] = MessageResponse;

/** Accessible name of an outbound result or citation link. */
const outboundLinkName = (label: string) => `${label} opens in a new tab`;

// The Parameters panel renders syntax-colored markup through the shared Shiki
// CodeBlock. Only the color-contrast rule is disabled.
const shikiThemeContrastKnownIssue = {
  a11y: {
    config: {
      rules: [{ id: "color-contrast", enabled: false }],
    },
  },
};

const meta = {
  component: WebSearchTool,
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
    input: { query: "llame web search" },
    output: {
      status: "success",
      kind: "results",
      engine: "brave",
      query: "llame web search",
      results: [],
    },
    errorText: undefined,
    state: "output-available" as const,
    Markdown: markdownRenderer,
  },
  argTypes: {
    Markdown: { control: false, table: { disable: true } },
  },
} satisfies Meta<typeof WebSearchTool>;

export default meta;

type Story = StoryObj<typeof meta>;

const resultsOutput = {
  status: "success" as const,
  kind: "results" as const,
  engine: "brave",
  query: "llame web search",
  results: [
    {
      title: "Llame release notes",
      url: "https://example.com/releases",
      published: "2026-10-08",
      snippet: "A concise overview of the latest release.",
    },
    {
      title: "Search architecture",
      url: "https://docs.example.com/search",
      published: "2026-09-30",
      snippet: "How the search chain and renderer fit together.",
    },
    {
      title: "Tool calling guide",
      url: "https://guide.example.com/tools",
      published: "2026-09-12",
      snippet: "A guide to reliable tool-calling interfaces.",
    },
  ],
};

/**
 * Use the results view when a search engine returns several normalized web
 * sources with enough context to choose the next page to read.
 *
 * @summary for a completed search with three linked sources
 */
export const Results: Story = {
  tags: ["ai-generated"],
  args: {
    output: resultsOutput,
  },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole("button", { name: /web_search/iu }));

    const releaseNotes = canvas.getByRole("button", {
      name: outboundLinkName("Llame release notes"),
    });

    await expect(releaseNotes).toBeInTheDocument();
    await expect(releaseNotes.querySelector("svg")).toHaveAttribute(
      "aria-hidden",
      "true",
    );
    await expect(
      canvas.getByRole("button", {
        name: outboundLinkName("Search architecture"),
      }),
    ).toBeInTheDocument();
    await expect(
      canvas.getByRole("button", {
        name: outboundLinkName("Tool calling guide"),
      }),
    ).toBeInTheDocument();
    await expect(canvas.getByText(/^example\.com\b/iu)).toBeInTheDocument();
    await expect(canvas.getByText(/2026-10-08/iu)).toBeInTheDocument();
    await expect(
      canvas.getByText(/A concise overview of the latest release/iu),
    ).toBeInTheDocument();

    await userEvent.click(releaseNotes);
    await expect(canvas.getByText("Open external link?")).toBeVisible();
    await expect(
      canvas.getByText("You're about to visit an external website."),
    ).toBeVisible();

    // Streamdown's link-safety overlay nests focusable controls inside a
    // `role="button"` backdrop (axe nested-interactive) — a third-party defect
    // outside this component, so dismiss it before the a11y check runs.
    await userEvent.keyboard("{Escape}");
    await expect(
      canvas.queryByText("Open external link?"),
    ).not.toBeInTheDocument();
  },
};

/**
 * Use the answer view when an engine returns a synthesized Markdown response
 * alongside the sources that support its claims.
 *
 * @summary for a Markdown answer followed by numbered citations
 */
export const Answer: Story = {
  tags: ["ai-generated"],
  args: {
    output: {
      status: "success" as const,
      kind: "answer" as const,
      engine: "perplexity",
      query: "what changed in llame search",
      answer: "**The answer** is concise.\n\nIt includes *context*.",
      citations: [
        { title: "Search design", url: "https://example.com/design" },
        { title: "Search output", url: "https://example.com/output" },
      ],
    },
  },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole("button", { name: /web_search/iu }));
    await expect(canvas.getByText("The answer")).toBeInTheDocument();
    await expect(canvas.getByText("context")).toBeInTheDocument();

    const citation = canvas.getByRole("button", {
      name: outboundLinkName("Search design"),
    });

    await expect(citation).toBeInTheDocument();
    await expect(citation.querySelector("svg")).toHaveClass("size-3");
    await expect(
      canvas.getByRole("button", { name: outboundLinkName("Search output") }),
    ).toBeInTheDocument();
  },
};

/**
 * Use the empty state when a successful search completes without any sources;
 * it is neutral feedback rather than a tool error.
 *
 * @summary for a completed search with no matching results
 */
export const Empty: Story = {
  tags: ["ai-generated"],
  args: {},
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole("button", { name: /web_search/iu }));
    await expect(canvas.getByText("No results found.")).toBeInTheDocument();
    await expect(canvas.getByText("Engine:")).toBeInTheDocument();
  },
};

/**
 * Use the error state when the engine fails, keeping the original parameters
 * available while the shared ToolOutput presents the failure panel.
 *
 * @summary for a failed search invocation
 */
export const Error: Story = {
  tags: ["ai-generated"],
  args: {
    output: undefined,
    errorText: "The web search engine timed out.",
    state: "output-error" as const,
  },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole("button", { name: /web_search/iu }));
    await expect(
      canvas.getByText("Error", { selector: "h4" }),
    ).toBeInTheDocument();
    await expect(
      canvas.getByText("The web search engine timed out."),
    ).toBeInTheDocument();
  },
};

/**
 * Use the cancelled state when the user stops a run before the search settles;
 * the cancellation marker is neutral and must not expose the transport error.
 *
 * @summary for a search cancelled by the user
 */
export const Cancelled: Story = {
  tags: ["ai-generated"],
  args: {
    output: undefined,
    errorText: "The run was cancelled before this tool finished.",
    state: "cancelled" as const,
  },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole("button", { name: /web_search/iu }));
    await expect(canvas.getByText("Cancelled")).toBeInTheDocument();
    await expect(
      canvas.queryByText("The run was cancelled before this tool finished."),
    ).not.toBeInTheDocument();
    await expect(canvas.queryByText("Error")).not.toBeInTheDocument();
  },
};

/**
 * Use the running state while the search request is in flight and no output is
 * available yet; the header and body communicate that work is underway.
 *
 * @summary for a search that is still running
 */
export const Running: Story = {
  tags: ["ai-generated"],
  args: {
    output: undefined,
    errorText: undefined,
    state: "input-available" as const,
  },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole("button", { name: /web_search/iu }));
    await expect(canvas.getByText("Running")).toBeInTheDocument();
    await expect(canvas.getByText("Searching…")).toBeInTheDocument();
  },
};

/**
 * URLs are untrusted historical data at this boundary. A non-http(s) URL stays
 * visible as escaped text and never becomes an executable Markdown link.
 *
 * @summary for a result with an unsafe URL
 */
export const UnsafeUrl: Story = {
  tags: ["ai-generated"],
  args: {
    output: {
      status: "success" as const,
      kind: "results" as const,
      engine: "fixture",
      query: "unsafe URL",
      results: [
        {
          title: "Suspicious [result]",
          url: "javascript:alert(1)",
          snippet: "This source is deliberately rejected by the renderer.",
        },
      ],
    },
  },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole("button", { name: /web_search/iu }));
    await expect(canvas.getByText("Suspicious [result]")).toBeInTheDocument();
    await expect(
      canvas.queryByRole("button", { name: "Suspicious [result]" }),
    ).not.toBeInTheDocument();
    await expect(canvas.queryByRole("link")).not.toBeInTheDocument();
    await expect(
      canvas.getByText("Suspicious [result]").closest("a"),
    ).toBeNull();
    await expect(
      canvas.getByText("This source is deliberately rejected by the renderer."),
    ).toBeInTheDocument();
  },
};

/**
 * Engines may return an empty title or a full ISO timestamp. The row stays
 * named by its URL and shows only the date.
 *
 * @summary for a result with an empty title and a timestamp
 */
export const UntitledTimestampedResult: Story = {
  tags: ["ai-generated"],
  args: {
    output: {
      status: "success" as const,
      kind: "results" as const,
      engine: "fixture",
      query: "engine values",
      results: [
        {
          title: "",
          url: "https://example.com/untitled",
          published: "2024-01-15T10:30:00.000Z",
          snippet: "Body text.",
        },
      ],
    },
  },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole("button", { name: /web_search/iu }));
    await expect(
      canvas.getByRole("button", {
        name: outboundLinkName("https://example.com/untitled"),
      }),
    ).toBeInTheDocument();
    await expect(
      canvas.getByText("example.com · 2024-01-15 · Body text."),
    ).toBeInTheDocument();
  },
};

/**
 * Result titles are plain text, so Markdown and LaTeX delimiters in them stay
 * literal link text instead of rendering as math or formatting.
 *
 * @summary for results whose titles contain Markdown and math delimiters
 */
export const MarkdownTitles: Story = {
  tags: ["ai-generated"],
  args: {
    output: {
      status: "success" as const,
      kind: "results" as const,
      engine: "fixture",
      query: "markdown titles",
      results: [
        {
          title: "Python (programming language) - Wikipedia",
          url: "https://en.wikipedia.org/wiki/Python_(programming_language)",
        },
        {
          title: "Release notes [v2.0] and more",
          url: "https://example.com/releases/v2",
        },
        {
          title: "Price $5 & $10 *now*",
          url: "https://example.com/pricing",
        },
      ],
    },
  },
  play: async ({ canvas, canvasElement, userEvent }) => {
    await userEvent.click(canvas.getByRole("button", { name: /web_search/iu }));
    await expect(
      canvas.getByRole("button", {
        name: outboundLinkName("Python (programming language) - Wikipedia"),
      }),
    ).toBeInTheDocument();
    await expect(
      canvas.getByRole("button", {
        name: outboundLinkName("Release notes [v2.0] and more"),
      }),
    ).toBeInTheDocument();
    await expect(
      canvas.getByRole("button", {
        name: outboundLinkName("Price $5 & $10 *now*"),
      }),
    ).toBeInTheDocument();
    await expect(canvasElement.querySelector(".katex")).toBeNull();
  },
};

/**
 * Engine notes preserve useful fan-out and truncation context without adding a
 * chromatic badge or competing with the result content.
 *
 * @summary for a search result carrying engine notes
 */
export const Notes: Story = {
  tags: ["ai-generated"],
  args: {
    output: {
      ...resultsOutput,
      engine: "aggregate",
      notes: [
        "brave returned the highest-ranked source",
        "two engines timed out",
      ],
    },
  },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole("button", { name: /web_search/iu }));
    await expect(canvas.getByText("Engine:")).toBeInTheDocument();
    await expect(canvas.getByText(/aggregate/iu)).toBeInTheDocument();
    await expect(
      canvas.getByText(/brave returned the highest-ranked source/iu),
    ).toBeInTheDocument();
    await expect(
      canvas.getByText(/two engines timed out/iu),
    ).toBeInTheDocument();
  },
};

/**
 * An aggregate can also carry the grounded answers of its hosted children. Each
 * answer follows the results, named by its engine id, with its citation links.
 *
 * @summary for an aggregate that attaches one hosted answer
 */
export const AggregateAnswers: Story = {
  tags: ["ai-generated"],
  args: {
    output: {
      ...resultsOutput,
      engine: "aggregate",
      answers: [
        {
          engine: "claude-search",
          answer:
            "**Aggregate answers** come from the hosted child.\n\nIt cites two sources.",
          citations: [
            { title: "Hosted context", url: "https://example.com/context" },
            // Untrusted historical data: a non-http(s) citation is text only.
            { url: "javascript:alert(1)" },
          ],
        },
      ],
    },
  },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole("button", { name: /web_search/iu }));

    const lastResult = canvas.getByRole("button", {
      name: outboundLinkName("Tool calling guide"),
    });

    const answer = canvas.getByText("Aggregate answers");
    await expect(answer).toBeInTheDocument();
    await expect(
      Boolean(
        lastResult.compareDocumentPosition(answer) &
        Node.DOCUMENT_POSITION_FOLLOWING,
      ),
    ).toBe(true);
    await expect(canvas.getByText(/claude-search/u)).toBeInTheDocument();
    await expect(canvas.getByText("It cites two sources.")).toBeInTheDocument();
    await expect(
      canvas.getByRole("button", { name: outboundLinkName("Hosted context") }),
    ).toBeInTheDocument();
    await expect(
      canvas.queryByRole("button", { name: "javascript:alert(1)" }),
    ).not.toBeInTheDocument();
    await expect(
      canvas.getByText("javascript:alert(1)").closest("a"),
    ).toBeNull();
  },
};

/**
 * A web search part stored before `answers` existed still renders its results;
 * the missing field is optional and never an error.
 *
 * @summary for a stored results part without answers
 */
export const StoredResultsWithoutAnswers: Story = {
  tags: ["ai-generated"],
  args: {
    output: {
      status: "success" as const,
      kind: "results" as const,
      engine: "searxng",
      query: "self-hosted search engines",
      results: [
        {
          title: "Self-hosted metasearch notes",
          url: "https://notes.example.net/searxng",
          published: "2025-11-02",
        },
        {
          title: "Metasearch comparison",
          url: "https://example.org/metasearch",
        },
      ],
    },
  },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole("button", { name: /web_search/iu }));
    await expect(
      canvas.getByRole("button", {
        name: outboundLinkName("Self-hosted metasearch notes"),
      }),
    ).toBeInTheDocument();
    await expect(canvas.getByText(/searxng/u)).toBeInTheDocument();
    // Only the result list renders: a stored part without `answers` adds no
    // answer block.
    await expect(canvas.getAllByRole("list")).toHaveLength(1);
  },
};

const rerank = {
  model: "jev-1.14",
  order: ["p2", "p0", "p1"],
  scores: { p2: 0.91, p0: 0.42, p1: 0.07 },
  latencyMs: 412,
  costUsd: 0.0007,
};

const rankedResults = [
  resultsOutput.results[2],
  resultsOutput.results[0],
  resultsOutput.results[1],
];

/**
 * A ranked call shows one badge with the served model, latency, and cost, and
 * each row carries its judged score and card key.
 *
 * @summary for a search ranked by the decision model
 */
export const Ranked: Story = {
  tags: ["ai-generated"],
  args: {
    output: {
      ...resultsOutput,
      results: rankedResults,
      display: { rerank },
    },
  },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole("button", { name: /web_search/iu }));
    await expect(canvas.getByText("Ranked by jev-1.14")).toBeVisible();
    await expect(canvas.getByText("· 412 ms · $0.0007")).toBeVisible();
    await expect(canvas.getAllByText(/score/u)).toHaveLength(3);
    const rows = canvas.getAllByRole("listitem");
    await expect(rows[0]).toContainElement(
      canvas.getByText("#1 · p2 · score 0.91"),
    );
    await expect(rows[0]).toContainElement(
      canvas.getByText("Tool calling guide"),
    );
    await expect(rows[2]).toContainElement(
      canvas.getByText("#3 · p1 · score 0.07"),
    );
  },
};

/**
 * When the model judged only some results, the judged rows show scores and the
 * unjudged rows show none.
 *
 * @summary for a partly judged ranking
 */
export const RankedPartial: Story = {
  tags: ["ai-generated"],
  args: {
    output: {
      ...resultsOutput,
      results: rankedResults,
      display: { rerank: { ...rerank, scores: { p2: 0.91, p0: 0.42 } } },
    },
  },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole("button", { name: /web_search/iu }));
    await expect(canvas.getAllByText(/score/u)).toHaveLength(2);
    await expect(canvas.queryByText(/p1/u)).not.toBeInTheDocument();
  },
};

/**
 * The record names every judged key, but only the rows the output holds show
 * scores; no row appears for an omitted result.
 *
 * @summary for a record with more judged keys than rows
 */
export const RankedOmittedRows: Story = {
  tags: ["ai-generated"],
  args: {
    output: {
      ...resultsOutput,
      results: rankedResults.slice(0, 1),
      display: { rerank },
    },
  },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole("button", { name: /web_search/iu }));
    await expect(canvas.getAllByText(/score/u)).toHaveLength(1);
    await expect(canvas.getAllByRole("listitem")).toHaveLength(1);
  },
};

/**
 * A failed rank call keeps engine order, stores no record, and shows the
 * failure note with the others.
 *
 * @summary for a search whose rank call failed
 */
export const RankUnavailable: Story = {
  tags: ["ai-generated"],
  args: {
    output: {
      ...resultsOutput,
      notes: ["two engines timed out", "rerank: unavailable"],
    },
  },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole("button", { name: /web_search/iu }));
    await expect(canvas.getByText(/\[rerank: unavailable\]/u)).toBeVisible();
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
  args: { output: resultsOutput },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole("button", { name: /web_search/iu }));
    await expect(canvas.queryByText(/Ranked by/u)).not.toBeInTheDocument();
    await expect(canvas.queryByText(/score/u)).not.toBeInTheDocument();
  },
};
