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
    await expect(dialog.getByText(RECEIPT.modelId)).toBeVisible();
    await expect(dialog.getByText("Model-specific override")).toBeVisible();
    await expect(
      dialog.getByText("You are the complete model-specific prompt."),
    ).toBeVisible();
    await expect(dialog.getByText("7f07b813")).toBeVisible();
    await expect(dialog.getByText("prepared")).toBeVisible();
    // This receipt carries no effort, so the row must be absent rather than
    // rendered empty (see the Effort story for the other side).
    await expect(dialog.queryByText("Effort")).toBeNull();
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

/**
 * A receipt that ran at an explicit reasoning effort: the metadata grows the
 * Effort row, so the owner auditing a prompt can see which setting shaped it.
 *
 * @summary effort row shown when the run carried a setting
 */
export const Effort: Story = {
  tags: ["ai-generated"],
  beforeEach: () => {
    useRunContextReceipt.mockReturnValue({
      isPending: false,
      isError: false,
      data: { ...RECEIPT, effort: "high" },
    });
  },
  play: async () => {
    const dialog = within(
      await within(document.body).findByRole("dialog", {
        name: "System prompt receipt",
      }),
    );
    await expect(dialog.getByText("Effort")).toBeVisible();
    await expect(dialog.getByText("high")).toBeVisible();
  },
};

/**
 * The attempt ran the project's own system prompt instead of a
 * model-specific override — the Source row names which prompt actually ran,
 * so the label follows the receipt rather than a fixed string.
 *
 * @summary project-default prompt source labelled
 */
export const ProjectDefault: Story = {
  tags: ["ai-generated"],
  beforeEach: () => {
    useRunContextReceipt.mockReturnValue({
      isPending: false,
      isError: false,
      data: {
        ...RECEIPT,
        receipts: [{ ...RECEIPT.receipts[0], promptSource: "project_default" }],
      },
    });
  },
  play: async () => {
    const dialog = within(
      await within(document.body).findByRole("dialog", {
        name: "System prompt receipt",
      }),
    );
    await expect(dialog.getByText("Project default")).toBeVisible();
  },
};

/**
 * The receipt query failed: the panel says the receipt could not be loaded
 * instead of leaving an empty metadata block, so a failure is never read as a
 * run that prepared no prompt.
 *
 * @summary failed receipt query reports itself
 */
export const Error: Story = {
  tags: ["ai-generated"],
  beforeEach: () => {
    useRunContextReceipt.mockReturnValue({
      isPending: false,
      isError: true,
      data: undefined,
    });
  },
  play: async () => {
    const dialog = within(
      await within(document.body).findByRole("dialog", {
        name: "System prompt receipt",
      }),
    );
    await expect(
      dialog.getByText("Could not load the receipt for this run."),
    ).toBeVisible();
  },
};

/**
 * A run still queued has no attempt yet: the panel says the prompt is coming,
 * which is a different answer from "no receipt was produced".
 *
 * @summary queued run with no prepared attempt
 */
export const Queued: Story = {
  tags: ["ai-generated"],
  beforeEach: () => {
    useRunContextReceipt.mockReturnValue({
      isPending: false,
      isError: false,
      data: {
        ...RECEIPT,
        state: "pending",
        activeAttemptId: undefined,
        completedAttemptId: undefined,
        receipts: [],
      },
    });
  },
  play: async () => {
    const dialog = within(
      await within(document.body).findByRole("dialog", {
        name: "System prompt receipt",
      }),
    );
    await expect(
      dialog.getByText(
        "This run is queued; no attempt has prepared a prompt yet.",
      ),
    ).toBeVisible();
  },
};
