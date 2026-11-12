import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, fn, waitFor } from "storybook/test";

import { CodeBlock, CodeBlockCopyButton } from "./code-block.js";

const sampleCode = `function greet(name: string) {
  return "Hello, " + name + "!";
}`;

async function waitForHighlightedTokens(canvasElement: HTMLElement) {
  await waitFor(() => {
    expect(
      canvasElement.querySelector('code span[style*="color"]'),
    ).not.toBeNull();
  });
}

const meta = {
  component: CodeBlock,
  // Full-width: CodeBlock is a `w-full` filler, so let it span the canvas and
  // align to the real edges. No narrowing decorator — a centered inner column
  // inside the full-width padded root reads as a container-floating-in-a-
  // container in the visual capture.
  parameters: { layout: "padded" },
  tags: ["autodocs"],
  args: {
    code: sampleCode,
    language: "ts",
  },
} satisfies Meta<typeof CodeBlock>;

export default meta;

type Story = StoryObj<typeof meta>;

// Module-scoped so both `render` and `play` see the same spy without widening
// the story's args past CodeBlock's own props.
const onCopy = fn();

/**
 * Highlights a short snippet with the default themed light/dark output and
 * no line-number gutter or overlay actions.
 *
 * @summary for a plain highlighted snippet
 */
export const Basic: Story = {
  tags: ["ai-generated"],
  play: async ({ canvasElement }) => {
    await waitForHighlightedTokens(canvasElement);
  },
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
  play: async ({ canvasElement }) => {
    await waitForHighlightedTokens(canvasElement);
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
      <CodeBlockCopyButton aria-label="Copy code" onCopy={onCopy} />
    </CodeBlock>
  ),
  play: async ({ canvas, canvasElement, userEvent }) => {
    await waitForHighlightedTokens(canvasElement);
    onCopy.mockClear();

    const clipboardDescriptor = Object.getOwnPropertyDescriptor(
      navigator,
      "clipboard",
    );

    const writeText = fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });

    try {
      const button = canvas.getByRole("button", { name: "Copy code" });
      await userEvent.click(button);
      await expect(writeText).toHaveBeenCalledOnce();
      await expect(writeText).toHaveBeenCalledWith(sampleCode);
      await expect(onCopy).toHaveBeenCalledOnce();
    } finally {
      if (clipboardDescriptor) {
        Object.defineProperty(navigator, "clipboard", clipboardDescriptor);
      } else {
        Reflect.deleteProperty(navigator, "clipboard");
      }
    }
  },
};
