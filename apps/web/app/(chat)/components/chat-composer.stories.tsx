import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, fn, within } from "storybook/test";
import { vi } from "vitest";

import { ChatProvider } from "@/contexts/chat-context";
import * as modelQueries from "@/lib/services/models/queries";
import type { AvailableModel } from "@/lib/services/models/queries";
import { ChatComposer } from "./chat-composer";

const useModelsQuery = vi.mocked(modelQueries.useModelsQuery, {
  partial: true,
});

const CATALOG = {
  defaultModelId: "system:openai:model-one",
  models: [
    {
      id: "system:openai:model-one",
      source: "system",
      name: "Model One",
      contextWindowTokens: 128_000,
    },
  ],
} satisfies { defaultModelId: string; models: Array<AvailableModel> };

const meta = {
  component: ChatComposer,
  tags: ["autodocs"],
  beforeEach: () => {
    useModelsQuery.mockReturnValue({
      data: CATALOG,
      isError: false,
      isPending: false,
    });
  },
  decorators: [
    (Story) => (
      <ChatProvider>
        <div className="w-full max-w-3xl">
          <Story />
        </div>
      </ChatProvider>
    ),
  ],
  args: {
    input: "",
    onInputChange: fn(),
    onSubmit: fn(),
    onStop: fn(),
    status: "ready",
    modelReadyForSend: true,
    modelSendUnavailableReason: null,
    pendingStop: false,
  },
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof ChatComposer>;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * Composer control states S1–S4 (design M3): enabled Stop for in-flight
 * turns, disabled spinner only while a held Stop waits for the Run id.
 *
 * @summary Stop enabled in S1–S3; spinner disabled in S4
 */
export const ControlStates: Story = {
  tags: ["ai-generated"],
  render: (args) => (
    <div className="flex flex-col gap-6">
      <div data-testid="s1">
        <p className="mb-2 text-xs text-muted-foreground">S1 submitted</p>
        <ChatComposer {...args} status="submitted" pendingStop={false} />
      </div>
      <div data-testid="s2">
        <p className="mb-2 text-xs text-muted-foreground">
          S2 id known, no output
        </p>
        <ChatComposer {...args} status="streaming" pendingStop={false} />
      </div>
      <div data-testid="s3">
        <p className="mb-2 text-xs text-muted-foreground">S3 streaming</p>
        <ChatComposer {...args} status="streaming" pendingStop={false} />
      </div>
      <div data-testid="s4">
        <p className="mb-2 text-xs text-muted-foreground">S4 pending stop</p>
        <ChatComposer {...args} status="submitted" pendingStop />
      </div>
    </div>
  ),
  play: async ({ canvasElement }) => {
    const root = within(canvasElement);
    for (const state of ["s1", "s2", "s3"] as const) {
      const region = within(root.getByTestId(state));
      const stop = region.getByRole("button", { name: "Stop generation" });
      await expect(stop).toBeEnabled();
    }
    const s4 = within(root.getByTestId("s4"));
    const stopping = s4.getByRole("button", { name: "Stopping generation" });
    await expect(stopping).toBeDisabled();
  },
};
