import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import { CodeBlock, CodeBlockCode, CodeBlockGroup } from "./code-block.js";

// CodeBlock has no upstream shadcn docs example — it is our own component
// (Shiki-backed syntax highlighting), so every story here carries the
// "ai-generated" provenance tag.
const meta = {
  component: CodeBlock,
  subcomponents: { CodeBlockCode, CodeBlockGroup },
  parameters: {
    layout: "centered",
  },
  // CodeBlock holds a block of code, so give it a fixed frame like the
  // docs' own preview width rather than letting each story pick its own
  // size.
  decorators: [
    (Story) => (
      <div className="w-[28rem] max-w-full">
        <Story />
      </div>
    ),
  ],
  tags: ["autodocs"],
} satisfies Meta<typeof CodeBlock>;

export default meta;

type Story = StoryObj<typeof meta>;

/**
 * Use the default composition — a `CodeBlock` wrapping a single
 * `CodeBlockCode` — to render a highlighted snippet in a chat message, doc,
 * or tool-output panel. The `theme` prop is set explicitly here: the
 * component's own `"github-light"` default colors some TypeScript tokens
 * (e.g. parameter names) below our a11y gate's contrast threshold, so this
 * story uses the accessible `"github-light-high-contrast"` Shiki theme
 * instead — a real prop value, not a suppression.
 *
 * @summary for the standard highlighted code snippet
 */
export const Basic: Story = {
  tags: ["ai-generated"],
  args: {
    children: (
      <CodeBlockCode
        code={
          "function greet(name: string): string {\n" +
          "  return `Hello, ${name}!`;\n" +
          "}"
        }
        language="typescript"
        theme="github-light-high-contrast"
        tabIndex={0}
        role="region"
        aria-label="Highlighted TypeScript code"
      />
    ),
  },
};

/**
 * `CodeBlockCode`'s `language` selects the Shiki grammar used for
 * highlighting; an unrecognized id falls back to `plaintext`. Shown here
 * across a few common languages.
 *
 * @summary reference of the language prop across a few common languages
 */
export const Languages: Story = {
  tags: ["ai-generated"],
  render: () => (
    <div className="flex flex-col gap-4">
      <CodeBlock>
        <CodeBlockCode
          code={`SELECT id, email\nFROM users\nWHERE active = true;`}
          language="sql"
          tabIndex={0}
          role="region"
          aria-label="Highlighted SQL code"
        />
      </CodeBlock>
      <CodeBlock>
        <CodeBlockCode
          code={`{\n  "name": "llame",\n  "private": true\n}`}
          language="json"
          tabIndex={0}
          role="region"
          aria-label="Highlighted JSON code"
        />
      </CodeBlock>
      <CodeBlock>
        <CodeBlockCode
          code={`pnpm install && pnpm dev`}
          language="bash"
          tabIndex={0}
          role="region"
          aria-label="Highlighted shell code"
        />
      </CodeBlock>
    </div>
  ),
};

/**
 * Use `CodeBlockGroup` as a header row above `CodeBlockCode` — e.g. a
 * filename label — to identify the snippet before its content. The code
 * region gets `tabIndex`/`role="region"`/`aria-label` (via `CodeBlockCode`'s
 * prop pass-through) since its line is wide enough to scroll horizontally —
 * the minimum fix our a11y gate requires for a scrollable region, matching
 * the same pattern used for Card's `EdgeToEdge` story.
 *
 * @summary for a CodeBlock with a filename/header row above the code
 */
export const WithGroupHeader: Story = {
  tags: ["ai-generated"],
  render: () => (
    <CodeBlock>
      <CodeBlockGroup className="border-b border-border px-4 py-2 text-xs text-muted-foreground">
        <span className="font-mono">apps/api/src/worker.ts</span>
      </CodeBlockGroup>
      <CodeBlockCode
        code={`import { RunsWorkerService } from "./runs/runs-worker.service.js";\n\nawait RunsWorkerService.start();`}
        language="typescript"
        tabIndex={0}
        role="region"
        aria-label="Highlighted TypeScript code"
      />
    </CodeBlock>
  ),
};
