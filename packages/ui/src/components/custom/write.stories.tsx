import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect } from "storybook/test";

import { contrastKnownIssue232 } from "../known-a11y-issues.js";
import { WriteTool } from "./write.js";

const content = "# Release notes\n\n- Dedicated tool rows\n";

const meta = {
  component: WriteTool,
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
    input: { path: "docs/release.md", content },
    output: {
      status: "success" as const,
      operation: "write" as const,
      path: "docs/release.md",
      created: true as const,
      lineCount: 3,
    },
    errorText: undefined,
    state: "output-available" as const,
  },
} satisfies Meta<typeof WriteTool>;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * Use for a completed write: the whole content with line numbers in a
 * gutter, and whether the file was created.
 *
 * @summary for a write that created a file
 */
export const Basic: Story = {
  tags: ["ai-generated"],
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole("button", { name: /write/iu }));
    await expect(canvas.getByText("New file")).toBeInTheDocument();
    await expect(canvas.getByText("3 lines")).toBeInTheDocument();
    const written = canvas.getByRole("group", { name: "Written content" });
    await expect(written).toHaveTextContent("Dedicated tool rows");
    await expect(written).not.toHaveTextContent("3: -");
    await expect(canvas.getByText("Created the file")).toBeInTheDocument();
  },
};

/**
 * A `replace: true` write names the replacement in its heading and result.
 *
 * @summary for a write that replaced a file
 */
export const Replaced: Story = {
  tags: ["ai-generated"],
  args: {
    input: { path: "docs/release.md", content, replace: true },
    output: {
      status: "success" as const,
      operation: "write" as const,
      path: "docs/release.md",
      replaced: true as const,
      lineCount: 3,
    },
  },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole("button", { name: /write/iu }));
    await expect(canvas.getByText("Replace contents")).toBeInTheDocument();
    await expect(canvas.getByText("Replaced the file")).toBeInTheDocument();
  },
};

/**
 * A stored write names the written file's line count, so the content section's
 * heading reads it from the result instead of recounting the submitted text.
 *
 * @summary for a write whose result names its line count
 */
export const LineCount: Story = {
  tags: ["ai-generated"],
  args: {
    input: { path: "docs/notes.md", content: "one\ntwo\nthree\nfour\n" },
    output: {
      status: "success" as const,
      operation: "write" as const,
      path: "docs/notes.md",
      created: true as const,
      lineCount: 4,
    },
  },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole("button", { name: /write/iu }));
    await expect(canvas.getByText("4 lines")).toBeInTheDocument();
    await expect(canvas.getByText("Created the file")).toBeInTheDocument();
  },
};

/**
 * While the write runs, the content it will write already shows.
 *
 * @summary for a write that has not settled
 */
export const Running: Story = {
  tags: ["ai-generated"],
  args: { output: undefined, state: "input-available" as const },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole("button", { name: /write/iu }));
    await expect(
      canvas.getByRole("group", { name: "Written content" }),
    ).toHaveTextContent("Release notes");
    await expect(canvas.getByText("Running…")).toBeInTheDocument();
  },
};

/**
 * An empty write says so instead of showing an empty block.
 *
 * @summary for a write of an empty file
 */
export const EmptyFile: Story = {
  tags: ["ai-generated"],
  args: { input: { path: "docs/.keep", content: "" } },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole("button", { name: /write/iu }));
    await expect(canvas.getByText("Empty file.")).toBeInTheDocument();
  },
};

/**
 * A refused write keeps the content above the error.
 *
 * @summary for a write whose target already exists
 */
export const Failed: Story = {
  tags: ["ai-generated"],
  // #232: the destructive error panel's token pairing fails color-contrast.
  parameters: contrastKnownIssue232,
  args: {
    output: undefined,
    errorText:
      "The target already exists. Pass replace: true to replace its contents, or use edit for a partial change.",
    state: "output-error" as const,
  },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole("button", { name: /write/iu }));
    await expect(canvas.getByText(/The target already exists/u)).toBeVisible();
    await expect(
      canvas.getByRole("group", { name: "Written content" }),
    ).toBeVisible();
  },
};
