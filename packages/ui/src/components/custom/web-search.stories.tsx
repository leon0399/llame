import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect } from "storybook/test";

import { MessageResponse } from "@workspace/ui/components/ai-elements/message-response";

import { WebSearchTool, type WebSearchToolProps } from "./web-search.js";

const markdownRenderer: WebSearchToolProps["Markdown"] = MessageResponse;

const meta = {
  component: WebSearchTool,
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
      canvas.getByRole("link", { name: "Llame release notes" }),
    ).toBeInTheDocument();
    await expect(
      canvas.getByRole("link", { name: "Search architecture" }),
    ).toBeInTheDocument();
    await expect(
      canvas.getByRole("link", { name: "Tool calling guide" }),
    ).toBeInTheDocument();
    await expect(canvas.getByText(/^example\.com\b/iu)).toBeInTheDocument();
    await expect(canvas.getByText(/2026-10-08/iu)).toBeInTheDocument();
    await expect(
      canvas.getByText(/A concise overview of the latest release/iu),
    ).toBeInTheDocument();

    await userEvent.click(
      canvas.getByRole("link", { name: "Llame release notes" }),
    );
    await expect(canvas.getByText("Open external link?")).toBeVisible();
    await expect(
      canvas.getByText("You're about to visit an external website."),
    ).toBeVisible();
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
      canvas.getByRole("link", { name: "Search design" }),
    ).toBeInTheDocument();
    await expect(
      canvas.getByRole("link", { name: "Search output" }),
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
    await expect(canvas.getByText("Error")).toBeInTheDocument();
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
      canvas.queryByRole("link", { name: "Suspicious [result]" }),
    ).not.toBeInTheDocument();
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
