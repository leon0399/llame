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
      diff: "@@ replacement at line 12 @@\n-…\n+…\n",
      content: "12: export function greet(name: string) {\n",
      shownRange: { startLine: 12, endLine: 15 },
      truncated: false,
    },
    errorText: undefined,
    state: "output-available" as const,
  },
} satisfies Meta<typeof EditTool>;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * Use for a completed edit: a unified diff numbered from the line the result
 * names, unchanged lines as context, and the changed words emphasized.
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
