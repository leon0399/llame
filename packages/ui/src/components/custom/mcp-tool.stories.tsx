import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect } from "storybook/test";

import { McpTool } from "./mcp-tool.js";

// The Parameters and JSON panels render through Shiki's one-light palette,
// whose token colors fall below WCAG AA; only color-contrast is disabled.
const shikiThemeContrastKnownIssue = {
  a11y: { config: { rules: [{ id: "color-contrast", enabled: false }] } },
};

const meta = {
  component: McpTool,
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
    name: "mcp__docs__find_docs",
    input: { query: "tool parts", limit: 5 },
    output: {
      status: "success" as const,
      output: {
        content: [
          { type: "text", text: "Found 1 match:\n<b>docs/guide.md</b>" },
        ],
        isError: false,
      },
    },
    errorText: undefined,
    state: "output-available" as const,
  },
  argTypes: { name: { control: false } },
} satisfies Meta<typeof McpTool>;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * Use for a completed MCP call: `server · tool` in the header and its text
 * content verbatim, never rendered as markup.
 *
 * @summary for an MCP call that returned text
 */
export const Basic: Story = {
  tags: ["ai-generated"],
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(
      canvas.getByRole("button", { name: /docs · find_docs/iu }),
    );
    await expect(canvas.getByText("tool parts")).toBeInTheDocument();
    await expect(
      canvas.getByRole("group", { name: "Text content" }),
    ).toHaveTextContent("<b>docs/guide.md</b>");
  },
};

/**
 * Structured content shows as JSON under the content blocks; a remote image
 * is named rather than loaded, and an unknown block shows as JSON.
 *
 * @summary for an MCP call with structured content and mixed blocks
 */
export const StructuredAndMixedBlocks: Story = {
  tags: ["ai-generated"],
  args: {
    output: {
      status: "success" as const,
      output: {
        content: [
          { type: "image", data: "iVBORw0KGgo=", mimeType: "image/png" },
          { type: "resource_link", uri: "file:///docs/guide.md" },
        ],
        structuredContent: { matches: ["docs/guide.md"] },
      },
    },
  },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(
      canvas.getByRole("button", { name: /docs · find_docs/iu }),
    );
    await expect(canvas.getByText("Image (image/png)")).toBeVisible();
    await expect(canvas.queryByRole("img")).not.toBeInTheDocument();
    await expect(
      canvas.getByRole("group", { name: "Content block" }),
    ).toBeVisible();
    await expect(canvas.getByText("Structured content")).toBeVisible();
  },
};

/**
 * A tool name that itself contains `__` keeps it, because only the first
 * separator after the prefix ends the server id.
 *
 * @summary for an MCP tool whose name contains the separator
 */
export const SeparatorInToolName: Story = {
  tags: ["ai-generated"],
  args: { name: "mcp__tracker__issues__list", output: undefined },
  play: async ({ canvas }) => {
    await expect(
      canvas.getByRole("button", { name: /tracker · issues__list/iu }),
    ).toBeInTheDocument();
  },
};

/**
 * A remote error reaches the owner as the generic error text.
 *
 * @summary for an MCP call the server reported as failed
 */
export const Failed: Story = {
  tags: ["ai-generated"],
  args: {
    output: undefined,
    errorText: "The remote tool reported an error.",
    state: "output-error" as const,
  },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(
      canvas.getByRole("button", { name: /docs · find_docs/iu }),
    );
    await expect(
      canvas.getByText("The remote tool reported an error."),
    ).toBeVisible();
  },
};
