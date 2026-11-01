import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, within } from "storybook/test";

import { contrastKnownIssue232 } from "../known-a11y-issues.js";
import { EditTool } from "./edit.js";

const oldText = [
  "export function greet(name: string) {",
  '  const greeting = "Hello";',
  "  return `${greeting}, ${name}`;",
  "}",
].join("\n");

const newText = [
  "export function greet(name: string) {",
  '  const greeting = "Welcome";',
  "  return `${greeting}, ${name}!`;",
  "}",
].join("\n");

const meta = {
  component: EditTool,
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
    input: { path: "apps/api/src/greet.ts", oldText, newText },
    output: {
      status: "success" as const,
      operation: "edit" as const,
      path: "apps/api/src/greet.ts",
      replacements: 1,
      content:
        '12: export function greet(name: string) {\n13:   const greeting = "Welcome";\n14:   return `${greeting}, ${name}!`;\n15: }\n',
      shownRange: { startLine: 12, endLine: 15 },
      truncated: false,
      lineCount: 15,
      display: { startLine: 12, oldText, newText },
    },
    errorText: undefined,
    state: "output-available" as const,
  },
} satisfies Meta<typeof EditTool>;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * Use for a completed edit: the result's `display` region as a unified diff,
 * numbered from the line the edit landed on, with the changed words
 * emphasized.
 *
 * @summary for a completed edit shown as a diff
 */
export const Basic: Story = {
  tags: ["ai-generated"],
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole("button", { name: /edit/iu }));
    await expect(canvas.getByText("+2 −2")).toBeInTheDocument();
    const diff = within(canvas.getByRole("group", { name: "Diff" }));
    // Context line 12 is numbered on both sides; the replaced line 13 once
    // per side.
    await expect(diff.getAllByText("12")).toHaveLength(2);
    await expect(diff.getAllByText("13")).toHaveLength(2);
    await expect(diff.getByText("Hello")).toBeInTheDocument();
    await expect(diff.getByText("Welcome")).toBeInTheDocument();
    await expect(diff.getAllByText("−")).toHaveLength(2);
    await expect(diff.getAllByText("+")).toHaveLength(2);
    // The stored post-edit region is never shown: it repeats the added lines.
    await expect(canvas.queryByText(/^12: /u)).not.toBeInTheDocument();
  },
};

/**
 * A tool part stored before results carried `display` still parses: its legacy
 * `diff` header names the start line, and the submitted old and new text build
 * the same numbered diff.
 *
 * @summary for an edit stored without display data
 */
export const Legacy: Story = {
  tags: ["ai-generated"],
  args: {
    output: {
      status: "success" as const,
      operation: "edit" as const,
      path: "apps/api/src/greet.ts",
      replacements: 1,
      diff: "@@ replacement at line 12 @@\n-…\n+…\n",
      content: "12: export function greet(name: string) {\n",
      shownRange: { startLine: 12, endLine: 15 },
      truncated: false,
    },
  },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole("button", { name: /edit/iu }));
    const diff = within(canvas.getByRole("group", { name: "Diff" }));
    await expect(diff.getAllByText("12")).toHaveLength(2);
    await expect(diff.getAllByText("13")).toHaveLength(2);
    await expect(diff.getByText("Welcome")).toBeInTheDocument();
  },
};

/**
 * While the edit runs the diff already shows, unnumbered, because only the
 * result names the line the replacement starts at.
 *
 * @summary for an edit that has not settled
 */
export const Running: Story = {
  tags: ["ai-generated"],
  args: { output: undefined, state: "input-available" as const },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole("button", { name: /edit/iu }));
    const diff = within(canvas.getByRole("group", { name: "Diff" }));
    await expect(diff.getByText("Welcome")).toBeInTheDocument();
    await expect(diff.queryByText("12")).not.toBeInTheDocument();
    await expect(canvas.getByText("Running…")).toBeInTheDocument();
  },
};

/**
 * A failed edit keeps the attempted diff above the error, so the owner can
 * see what the model tried to change.
 *
 * @summary for an edit whose old text was not found
 */
export const Failed: Story = {
  tags: ["ai-generated"],
  // #232: the destructive error panel's token pairing fails color-contrast.
  parameters: contrastKnownIssue232,
  args: {
    output: undefined,
    errorText: "old_text_not_found",
    state: "output-error" as const,
  },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole("button", { name: /edit/iu }));
    await expect(canvas.getByRole("group", { name: "Diff" })).toBeVisible();
    await expect(canvas.getByText("old_text_not_found")).toBeInTheDocument();
  },
};

/**
 * Replacing a run with a different number of lines marks whole lines, since
 * no line pairs with another.
 *
 * @summary for an edit that inserts lines
 */
export const Insertion: Story = {
  tags: ["ai-generated"],
  args: {
    input: {
      path: "notes.md",
      oldText: "# Notes\n",
      newText: "# Notes\n\n- first\n- second\n",
    },
    output: undefined,
    state: "input-available" as const,
  },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole("button", { name: /edit/iu }));
    await expect(canvas.getByText("+3 −0")).toBeInTheDocument();
    await expect(canvas.getByText("- second")).toBeInTheDocument();
  },
};

/**
 * An edit whose old and new text are identical succeeds without a change.
 *
 * @summary for a no-op edit
 */
export const NoChange: Story = {
  tags: ["ai-generated"],
  args: {
    input: { path: "notes.md", oldText: "same", newText: "same" },
    output: undefined,
  },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole("button", { name: /edit/iu }));
    await expect(canvas.getByText("No changes.")).toBeInTheDocument();
  },
};

/**
 * A fragment that gains a trailing line break is a real change, so the diff
 * shows it and says so instead of reporting no change.
 *
 * @summary for an edit that only adds a trailing line break
 */
export const TrailingLineBreak: Story = {
  tags: ["ai-generated"],
  args: {
    input: { path: "notes.md", oldText: "foo", newText: "foo\n" },
    output: undefined,
    state: "input-available" as const,
  },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole("button", { name: /edit/iu }));
    await expect(canvas.getByText("+1 −1")).toBeInTheDocument();
    await expect(
      canvas.getByText("Adds a trailing line break."),
    ).toBeInTheDocument();
  },
};

/**
 * A current result names the region it replaced, so the diff shows that text
 * and numbering even when the submitted input says otherwise.
 *
 * @summary when the result's display data differs from the submitted text
 */
export const Displayed: Story = {
  tags: ["ai-generated"],
  args: {
    input: {
      path: "apps/api/src/greet.ts",
      oldText: "submitted old",
      newText: "submitted new",
    },
    output: {
      status: "success" as const,
      operation: "edit" as const,
      path: "apps/api/src/greet.ts",
      replacements: 1,
      content: "4: kept line\n5: kept replacement\n",
      shownRange: { startLine: 4, endLine: 5 },
      truncated: false,
      lineCount: 5,
      display: {
        startLine: 4,
        oldText: "kept line\n",
        newText: "kept replacement\n",
      },
    },
    state: "output-available" as const,
  },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole("button", { name: /edit/iu }));
    await expect(canvas.getByText("+1 −1")).toBeInTheDocument();
    const diff = within(canvas.getByRole("group", { name: "Diff" }));
    // Only the changed words are distinct; the shared prefix stays context.
    await expect(diff.getByText("line")).toBeInTheDocument();
    await expect(diff.getByText("replacement")).toBeInTheDocument();
    // The numbers start at the result's `display.startLine`, on both sides.
    await expect(diff.getAllByText("4")).toHaveLength(2);
    await expect(canvas.queryAllByText(/submitted/u)).toHaveLength(0);
  },
};

/**
 * A deletion removes lines without adding any, so the diff counts zero added
 * lines and numbers the region it was taken from.
 *
 * @summary for an edit that only deletes lines
 */
export const Deletion: Story = {
  tags: ["ai-generated"],
  args: {
    input: {
      path: "notes.md",
      oldText: "keep\nremove one\nremove two\n",
      newText: "keep\n",
    },
    output: {
      status: "success" as const,
      operation: "edit" as const,
      path: "notes.md",
      replacements: 1,
      content: "9: keep\n",
      shownRange: { startLine: 9, endLine: 9 },
      truncated: false,
      lineCount: 9,
      display: {
        startLine: 9,
        oldText: "keep\nremove one\nremove two\n",
        newText: "keep\n",
      },
    },
    state: "output-available" as const,
  },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole("button", { name: /edit/iu }));
    await expect(canvas.getByText("+0 −2")).toBeInTheDocument();
    const diff = within(canvas.getByRole("group", { name: "Diff" }));
    // The kept line is context on both sides; the deleted lines only keep
    // their old numbers.
    await expect(diff.getAllByText("9")).toHaveLength(2);
    await expect(diff.getAllByText("10")).toHaveLength(1);
    await expect(diff.getByText("remove one")).toBeInTheDocument();
    await expect(diff.getByText("remove two")).toBeInTheDocument();
  },
};
