import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect } from "storybook/test";

import { MessageResponse } from "@workspace/ui/components/ai-elements/message-response";

import { WebSearchTool, type WebSearchToolProps } from "./web-search.js";

const markdownRenderer: WebSearchToolProps["Markdown"] = MessageResponse;

// The Parameters panel renders through the shared Shiki CodeBlock, whose
// built-in "one-light" palette ships token colors below WCAG AA color-contrast
// (e.g. #e45649 and #50a14f on white). Same third-party-theme defect that
// code-block.stories.tsx suppresses, and it only surfaces once Shiki's async
// highlight resolves (always, here, because the play function expands the
// panel first). Only the color-contrast rule is disabled.
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
    await expect(
      canvas.getByRole("button", { name: "Llame release notes" }),
    ).toBeInTheDocument();
    await expect(
      canvas.getByRole("button", { name: "Search architecture" }),
    ).toBeInTheDocument();
    await expect(
      canvas.getByRole("button", { name: "Tool calling guide" }),
    ).toBeInTheDocument();
    await expect(canvas.getByText(/^example\.com\b/iu)).toBeInTheDocument();
    await expect(canvas.getByText(/2026-10-08/iu)).toBeInTheDocument();
    await expect(
      canvas.getByText(/A concise overview of the latest release/iu),
    ).toBeInTheDocument();

    await userEvent.click(
      canvas.getByRole("button", { name: "Llame release notes" }),
    );
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
    await expect(
      canvas.getByRole("button", { name: "Search design" }),
    ).toBeInTheDocument();
    await expect(
      canvas.getByRole("button", { name: "Search output" }),
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
      canvas.getByRole("button", { name: "https://example.com/untitled" }),
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
        name: "Python (programming language) - Wikipedia",
      }),
    ).toBeInTheDocument();
    await expect(
      canvas.getByRole("button", { name: "Release notes [v2.0] and more" }),
    ).toBeInTheDocument();
    await expect(
      canvas.getByRole("button", { name: "Price $5 & $10 *now*" }),
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
