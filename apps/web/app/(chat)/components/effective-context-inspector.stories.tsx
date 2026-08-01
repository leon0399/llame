import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, within } from "storybook/test";

// Import via the REAL specifier: sb.mock (preview.tsx) redirects it to the
// __mocks__ module, so overriding `useRunContextReceipt.mockReturnValue(...)`
// here reaches the SAME instance the component reads (a direct __mocks__
// import would be a separate module instance).
import * as runs from "@/lib/services/chat/runs";
import type * as runsMock from "@/lib/services/chat/__mocks__/runs";
import { EffectiveContextInspector } from "./effective-context-inspector";

const { useRunContextReceipt } = runs as unknown as typeof runsMock;

const RECEIPT = {
  modelId: "custom:anthropic:sonnet",
  promptSource: "model_override" as const,
  systemPrompt: "You are the complete model-specific prompt.",
  tools: [
    {
      id: "search_conversations",
      description: "Search the owner's conversations.",
      inputSchema: {
        type: "object",
        properties: { query: { type: "string" } },
      },
    },
  ],
  contentHash: "7f07b813",
  createdAt: "2026-07-18T12:34:56.000Z",
};

const meta = {
  component: EffectiveContextInspector,
  tags: ["autodocs"],
  args: {
    runId: "a5dc235e-1de8-4aad-84d8-e0e247b6a135",
    open: true,
    onOpenChange: () => undefined,
  },
  beforeEach: () => {
    useRunContextReceipt.mockReturnValue({
      isPending: false,
      isError: false,
      data: RECEIPT,
    });
  },
} satisfies Meta<typeof EffectiveContextInspector>;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * The owner auditing exactly what a run saw: the complete receipt (prompt
 * source, full system prompt, advertised tools, content hash) with the
 * server-only host path structurally absent — never leaked to the client.
 *
 * @summary complete owner receipt without a host path
 */
export const Receipt: Story = {
  tags: ["ai-generated"],
  play: async () => {
    const dialog = within(
      await within(document.body).findByRole("dialog", {
        name: "Effective context",
      }),
    );
    await expect(dialog.getByText("Model-specific override")).toBeVisible();
    await expect(
      dialog.getByText("You are the complete model-specific prompt."),
    ).toBeVisible();
    await expect(dialog.getByText("search_conversations")).toBeVisible();
    await expect(dialog.getByText(/"query"/)).toBeVisible();
    await expect(dialog.getByText("7f07b813")).toBeVisible();
    // The configured systemPromptFile path is server-only (README contract).
    await expect(
      dialog.queryByText(/\/etc\/|systemPromptFile|host path/i),
    ).not.toBeInTheDocument();
  },
};

/**
 * The on-demand loading state while the receipt query is in flight — the
 * inspector opens instantly and fills in when the fetch settles.
 *
 * @summary pending state while the receipt loads
 */
export const Loading: Story = {
  tags: ["ai-generated"],
  beforeEach: () => {
    useRunContextReceipt.mockReturnValue({
      isPending: true,
      isError: false,
      data: undefined,
    });
  },
};
