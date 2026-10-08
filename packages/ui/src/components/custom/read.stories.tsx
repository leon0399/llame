import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect } from "storybook/test";

import { MessageResponse } from "@workspace/ui/components/ai-elements/message-response";

import { ReadTool, type ReadToolProps } from "./read.js";

const markdownRenderer: ReadToolProps["Markdown"] = MessageResponse;

// The Parameters panel renders through the shared Shiki CodeBlock, whose
// built-in "one-light" palette ships token colors below WCAG AA color-contrast.
// Same third-party-theme defect web-search.stories.tsx suppresses; only the
// color-contrast rule is disabled.
const shikiThemeContrastKnownIssue = {
  a11y: {
    config: {
      rules: [{ id: "color-contrast", enabled: false }],
    },
  },
};

const fileOutput = {
  status: "success" as const,
  kind: "file" as const,
  path: "/home/operator/repo/apps/api/src/main.ts",
  representation: "text" as const,
  content:
    "2: import { NestFactory } from '@nestjs/core';\n3: import { AppModule } from './app.module';\n4: \n5: async function bootstrap() {\n",
  requestedRange: { startLine: 3, endLine: 4 },
  shownRange: { startLine: 2, endLine: 5 },
  truncated: false,
};

const meta = {
  component: ReadTool,
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
    input: { path: "/home/operator/repo/apps/api/src/main.ts:3-4" },
    output: fileOutput,
    errorText: undefined,
    state: "output-available" as const,
    Markdown: markdownRenderer,
  },
  argTypes: {
    Markdown: { control: false, table: { disable: true } },
  },
} satisfies Meta<typeof ReadTool>;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * Use the file view for a host, `kb://`, or `skill://` read: the path, the
 * numbered lines exactly as the model received them, and the lines shown.
 *
 * @summary for a completed line-range read of a host file
 */
export const File: Story = {
  tags: ["ai-generated"],
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole("button", { name: /read/iu }));
    await expect(canvas.getByText(fileOutput.path)).toBeInTheDocument();
    await expect(
      canvas.getByText(/5: async function bootstrap\(\) \{/u),
    ).toBeInTheDocument();
    await expect(canvas.getByText("2–5")).toBeInTheDocument();
    await expect(canvas.queryByText("Truncated")).not.toBeInTheDocument();
  },
};

/**
 * A path through a symbolic link reports the canonical path it resolved to.
 *
 * @summary for a host read whose path differs from its real path
 */
export const RealPath: Story = {
  tags: ["ai-generated"],
  args: {
    output: {
      ...fileOutput,
      realPath: "/srv/checkouts/repo/apps/api/src/main.ts",
    },
  },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole("button", { name: /read/iu }));
    await expect(canvas.getByText("Resolves to:")).toBeInTheDocument();
    await expect(
      canvas.getByText("/srv/checkouts/repo/apps/api/src/main.ts"),
    ).toBeInTheDocument();
  },
};

const LONG_LINE = `1: ${"minified-bundle-token ".repeat(40)}\n`;

/**
 * A long source line wraps inside the content block instead of scrolling it,
 * so the block never becomes a scroll region a keyboard user cannot reach.
 *
 * @summary for a read whose line is wider than the panel
 */
export const LongLine: Story = {
  tags: ["ai-generated"],
  args: {
    output: {
      ...fileOutput,
      content: LONG_LINE,
      shownRange: { startLine: 1, endLine: 1 },
    },
  },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole("button", { name: /read/iu }));
    const block = canvas.getByText(
      (_, element) =>
        element?.tagName === "PRE" &&
        element.textContent.startsWith("1: minified-bundle-token"),
    );
    await expect(block.scrollWidth).toBeLessThanOrEqual(block.clientWidth);
  },
};

/**
 * A bounded read reports where the next read continues, one past the
 * zero-based `nextOffset`, and every shown range of a multi-range read.
 *
 * @summary for a truncated multi-range read
 */
export const Truncated: Story = {
  tags: ["ai-generated"],
  args: {
    input: { path: "/home/operator/repo/notes.md:1-5,21-" },
    output: {
      status: "success" as const,
      kind: "file" as const,
      path: "/home/operator/repo/notes.md",
      representation: "text" as const,
      content: "1: # Notes\n2: \n21: ## Later\n22: body\n",
      requestedRanges: [
        { startLine: 1, endLine: 5 },
        { startLine: 21, endLine: 4000 },
      ],
      shownRanges: [
        { startLine: 1, endLine: 2 },
        { startLine: 21, endLine: 22 },
      ],
      truncated: true,
      nextOffset: 22,
    },
  },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole("button", { name: /read/iu }));
    await expect(canvas.getByText("1–2, 21–22")).toBeInTheDocument();
    await expect(canvas.getByText(/continues at line 23/u)).toBeInTheDocument();
  },
};

/**
 * A directory read shows its listing; its continuation offset counts entries,
 * not lines, so only the truncation itself is reported.
 *
 * @summary for a truncated directory listing
 */
export const Directory: Story = {
  tags: ["ai-generated"],
  args: {
    input: { path: "/home/operator/repo" },
    output: {
      status: "success" as const,
      kind: "directory" as const,
      path: "/home/operator/repo",
      content:
        "/home/operator/repo\n- apps/\n  - api/\n  - web/\n- README.md\n",
      truncated: true,
      nextOffset: 4,
    },
  },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole("button", { name: /read/iu }));
    await expect(canvas.getByText(/- README\.md/u)).toBeInTheDocument();
    await expect(canvas.getByText("Truncated")).toBeInTheDocument();
    await expect(
      canvas.queryByText(/continues at line/u),
    ).not.toBeInTheDocument();
  },
};

/**
 * A web read names the URL that produced the content as a link through the
 * chat's link-safety renderer, with the method, the adapter, and its notes.
 *
 * @summary for a web read rendered by a configured adapter
 */
export const WebAdapter: Story = {
  tags: ["ai-generated"],
  args: {
    input: { path: "https://github.com/o/r/issues/1" },
    output: {
      status: "success" as const,
      kind: "file" as const,
      path: "https://github.com/o/r/issues/1",
      representation: "text" as const,
      content: "1: # Crash on startup\n2: \n3: Author: alice\n",
      requestedRange: { startLine: 1, endLine: 3 },
      shownRange: { startLine: 1, endLine: 3 },
      truncated: false,
      finalUrl: "https://github.com/o/r/issues/1",
      method: "adapter",
      adapter: { id: "github", route: "native" },
      notes: ["review comments omitted: rate_limit"],
    },
  },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole("button", { name: /read/iu }));
    const link = canvas.getByRole("button", {
      name: "https://github.com/o/r/issues/1",
    });
    await expect(link).toHaveAttribute("data-streamdown", "link");
    await expect(canvas.getByText("adapter (github)")).toBeInTheDocument();
    await expect(
      canvas.getByText("review comments omitted: rate_limit"),
    ).toBeInTheDocument();
  },
};

/**
 * Fetched URLs are untrusted. A non-http(s) `finalUrl` stays plain text and
 * never becomes an executable Markdown link.
 *
 * @summary for a web result with an unsafe final URL
 */
export const UnsafeUrl: Story = {
  tags: ["ai-generated"],
  args: {
    input: { path: "https://example.com/a" },
    output: {
      status: "success" as const,
      kind: "file" as const,
      path: "https://example.com/a",
      representation: "text" as const,
      content: "1: body\n",
      requestedRange: { startLine: 1, endLine: 1 },
      shownRange: { startLine: 1, endLine: 1 },
      truncated: false,
      finalUrl: "javascript:alert(1)",
      method: "raw",
    },
  },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole("button", { name: /read/iu }));
    await expect(canvas.getByText("javascript:alert(1)")).toBeInTheDocument();
    await expect(
      canvas.queryByRole("button", { name: "javascript:alert(1)" }),
    ).not.toBeInTheDocument();
    await expect(canvas.queryByRole("link")).not.toBeInTheDocument();
  },
};

/**
 * Use the error state when the read fails, keeping the original parameters
 * available while the shared ToolOutput presents the failure panel.
 *
 * @summary for a failed read
 */
export const Error: Story = {
  tags: ["ai-generated"],
  args: {
    output: undefined,
    errorText: "The path does not exist.",
    state: "output-error" as const,
  },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole("button", { name: /read/iu }));
    await expect(
      canvas.getByText("Error", { selector: "h4" }),
    ).toBeInTheDocument();
    await expect(
      canvas.getByText("The path does not exist."),
    ).toBeInTheDocument();
  },
};

/**
 * Use the cancelled state when the user stops a run before the read settles;
 * the cancellation marker is neutral and must not expose the transport error.
 *
 * @summary for a read cancelled by the user
 */
export const Cancelled: Story = {
  tags: ["ai-generated"],
  args: {
    output: undefined,
    errorText: "The run was cancelled before this tool finished.",
    state: "cancelled" as const,
  },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole("button", { name: /read/iu }));
    await expect(canvas.getByText("Cancelled")).toBeInTheDocument();
    await expect(
      canvas.queryByText("The run was cancelled before this tool finished."),
    ).not.toBeInTheDocument();
  },
};

/**
 * Use the running state while the read is in flight and no output exists yet.
 *
 * @summary for a read that is still running
 */
export const Running: Story = {
  tags: ["ai-generated"],
  args: {
    output: undefined,
    errorText: undefined,
    state: "input-available" as const,
  },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole("button", { name: /read/iu }));
    await expect(canvas.getByText("Running")).toBeInTheDocument();
    await expect(canvas.getByText("Reading…")).toBeInTheDocument();
  },
};
