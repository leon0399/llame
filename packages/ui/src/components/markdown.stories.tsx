import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import { Markdown } from "./markdown.js";

// Markdown has no upstream shadcn docs example — it is our own component
// (react-markdown + remark-gfm/remark-breaks, with CodeBlock-backed fenced
// code), so every story here carries the "ai-generated" provenance tag.
const meta = {
  component: Markdown,
  parameters: {
    layout: "centered",
  },
  // Markdown renders arbitrary blocks of text, so give it a fixed frame —
  // matching real usage (apps/web wraps message content in "prose") lets
  // headings/lists/emphasis render legibly instead of using browser defaults.
  decorators: [
    (Story) => (
      <div className="prose w-[28rem] max-w-full dark:prose-invert">
        <Story />
      </div>
    ),
  ],
  tags: ["autodocs"],
} satisfies Meta<typeof Markdown>;

export default meta;

type Story = StoryObj<typeof meta>;

/**
 * Renders the baseline Markdown building blocks — headings, a paragraph
 * with bold/italic emphasis, and both bullet and numbered lists — the
 * common shape of a chat response.
 *
 * @summary for headings, emphasis, and lists
 */
export const Basic: Story = {
  tags: ["ai-generated"],
  args: {
    children:
      "## Release notes\n\n" +
      "This update focuses on **durability** and *streaming* correctness.\n\n" +
      "Highlights:\n\n" +
      "- Runs now persist through worker restarts\n" +
      "- Reconnect resumes an in-flight stream\n" +
      "- Search indexing runs in the background\n\n" +
      "Rollout steps:\n\n" +
      "1. Apply the pending migration\n" +
      "2. Restart the worker\n" +
      "3. Verify a test run completes",
  },
};

/**
 * Inline code (single backticks) renders as a styled `<span>`; a fenced
 * code block (triple backticks with a language tag) renders through
 * `CodeBlock`/`CodeBlockCode` for syntax highlighting.
 *
 * @summary for inline code and syntax-highlighted fenced code blocks
 */
export const Code: Story = {
  tags: ["ai-generated"],
  args: {
    children:
      "Set `POSTGRES_URL` before running the worker:\n\n" +
      "```bash\n" +
      "export POSTGRES_URL=postgres://localhost/llame\n" +
      "pnpm --filter api start:worker\n" +
      "```",
  },
};

/**
 * GitHub Flavored Markdown (via `remark-gfm`) autolinks bare URLs and
 * renders standard `[text](url)` links.
 *
 * @summary for autolinked URLs and markdown links
 */
export const Links: Story = {
  tags: ["ai-generated"],
  args: {
    children:
      "See the [architecture spec](https://github.com/leon0399/llame/blob/master/SPEC.md) " +
      "or browse the repo directly: https://github.com/leon0399/llame",
  },
};

/**
 * Unlike vanilla CommonMark, a single trailing newline (`remark-breaks`)
 * renders as a line break rather than being collapsed — matching how chat
 * messages are usually typed, without requiring a hard two-space or
 * blank-line break.
 *
 * @summary for single-newline soft line breaks within a paragraph
 */
export const LineBreaks: Story = {
  tags: ["ai-generated"],
  args: {
    children: "Line one.\nLine two.\nLine three.",
  },
};
