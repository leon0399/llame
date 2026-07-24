import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect } from "storybook/test";

import { CodeBlock, CodeBlockCopyButton } from "./code-block.js";

const sampleCode = `function greet(name: string) {
  return "Hello, " + name + "!";
}`;

// Shiki's built-in "one-light"/"one-dark-pro" themes ship fixed syntax-token
// colors that fail WCAG AA color-contrast on some tokens (e.g. #4078f2 blue
// on white is ~4.04:1, below the 4.5:1 threshold). This is inherent to the
// third-party theme's palette, not our design tokens, and only surfaces once
// Shiki's async highlight has resolved — a race some stories win and some
// lose depending on test timing, so it's suppressed file-wide rather than
// per-story.
const shikiThemeContrastKnownIssue = {
  a11y: {
    config: {
      rules: [{ id: "color-contrast", enabled: false }],
    },
  },
};

const meta = {
  component: CodeBlock,
  parameters: { layout: "padded", ...shikiThemeContrastKnownIssue },
  tags: ["autodocs"],
  args: {
    code: sampleCode,
    language: "ts",
  },
} satisfies Meta<typeof CodeBlock>;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * Highlights a short snippet with the default themed light/dark output and
 * no line-number gutter or overlay actions.
 *
 * @summary for a plain highlighted snippet
 */
export const Basic: Story = {
  tags: ["ai-generated"],
};

/**
 * Use the line-number gutter for longer snippets where callers need to refer
 * to a specific line (e.g. pointing at an error or a diff hunk).
 *
 * @summary for a snippet with a line-number gutter
 */
export const WithLineNumbers: Story = {
  tags: ["ai-generated"],
  args: {
    showLineNumbers: true,
    language: "tsx",
    code: `export function Greeting({ name }: { name: string }) {
  return <p>Hello, {name}!</p>;
}`,
  },
};

/**
 * Render `CodeBlockCopyButton` as a child to overlay a copy action in the
 * block's top-right corner; it reads the code from `CodeBlock`'s context.
 *
 * Verbatim from [AI Elements CodeBlock › Usage](https://elements.ai-sdk.dev/components/code-block#usage),
 * adapted: the upstream example also composes `CodeBlockHeader`,
 * `CodeBlockTitle`, `CodeBlockFilename`, and `CodeBlockActions` (with a
 * `FileIcon`) around the copy button — this file only vendors `CodeBlock`
 * and `CodeBlockCopyButton`, so those wrapper subcomponents are dropped
 * rather than reinvented; a concrete snippet replaces the docs' undefined
 * `code` placeholder; and `aria-label="Copy code"` is added, since the
 * upstream example leaves the icon-only button without an accessible name.
 *
 * @summary for a snippet with a copy-to-clipboard action
 */
export const WithCopyButton: Story = {
  tags: ["ai-elements-example", "ai-generated"],
  args: { language: "typescript" },
  render: (args) => (
    <CodeBlock {...args}>
      <CodeBlockCopyButton aria-label="Copy code" />
    </CodeBlock>
  ),
  play: async ({ canvas, userEvent }) => {
    const button = canvas.getByRole("button", { name: "Copy code" });
    await userEvent.click(button);
    await expect(button).toBeVisible();
  },
};
