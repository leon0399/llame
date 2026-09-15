import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, within } from "storybook/test";
import { vi } from "vitest";

// Import via the REAL specifier: sb.mock (preview.tsx) redirects it to the
// __mocks__ module, so overriding `useRunContextReceipt.mockReturnValue(...)`
// here reaches the SAME instance the component reads (a direct __mocks__
// import would be a separate module instance).
import * as runs from "@/lib/services/chat/runs";
import { EffectiveContextInspector } from "./effective-context-inspector";

const useRunContextReceipt = vi.mocked(runs.useRunContextReceipt, {
  partial: true,
});

const RECEIPT = {
  modelId: "custom:anthropic:sonnet",
  effort: undefined,
  activeAttemptId: "a1b2c3d4-0000-0000-0000-000000000001",
  completedAttemptId: "a1b2c3d4-0000-0000-0000-000000000001",
  state: "prepared" as const,
  receipts: [
    {
      attemptId: "a1b2c3d4-0000-0000-0000-000000000001",
      promptSource: "model_override" as const,
      systemPrompt: "You are the complete model-specific prompt.",
      promptHash: "7f07b813",
      createdAt: "2026-07-18T12:34:56.000Z",
    },
  ],
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
 * The owner auditing what the attempt sent: the system-only receipt (attempt
 * id, prompt source, prompt hash, and the complete rendered system prompt)
 * with advertised tool declarations and server-only host paths structurally
 * absent — never persisted or leaked to the client.
 *
 * @summary system-only attempt receipt without a host path
 */
export const Receipt: Story = {
  tags: ["ai-generated"],
  play: async () => {
    const dialog = within(
      await within(document.body).findByRole("dialog", {
        name: "System prompt receipt",
      }),
    );
    await expect(dialog.getByText("Model-specific override")).toBeVisible();
    await expect(
      dialog.getByText("You are the complete model-specific prompt."),
    ).toBeVisible();
    await expect(dialog.getByText("7f07b813")).toBeVisible();
    await expect(dialog.getByText("prepared")).toBeVisible();
    // Tool declarations are runtime-only by contract, so nothing the client
    // renders may be tool-labelled. A data-value query could never fail: the
    // picked receipt type carries no tool data to render.
    await expect(dialog.queryByText(/tool/i)).toBeNull();
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
