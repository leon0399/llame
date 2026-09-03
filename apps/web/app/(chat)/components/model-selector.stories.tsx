import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";
import { vi } from "vitest";

import { ButtonGroup } from "@workspace/ui/components/button-group";

import { ChatProvider } from "@/contexts/chat-context";
// Import via the REAL specifier: sb.mock (preview.tsx) redirects it to the
// __mocks__ module, so this is the SAME hook instance the component reads.
import * as modelQueries from "@/lib/services/models/queries";
import type { AvailableModel } from "@/lib/services/models/queries";
import { ModelSelector } from "./model-selector";

const useModelsQuery = vi.mocked(modelQueries.useModelsQuery, {
  partial: true,
});

const CATALOG = {
  defaultModelId: "system:openai:model-two",
  models: [
    {
      id: "system:openai:model-one",
      source: "system",
      name: "Model One",
      contextWindowTokens: 128_000,
    },
    {
      id: "system:openai:model-two",
      source: "system",
      name: "Model Two",
      contextWindowTokens: 400_000,
    },
  ],
} satisfies { defaultModelId: string; models: Array<AvailableModel> };

const meta = {
  component: ModelSelector,
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
        {/* Always the group's first cell in production, and it no longer
            carries its own border or corner classes — ButtonGroup owns those.
            Previewing it bare would show a shape it never actually ships. */}
        <ButtonGroup>
          <Story />
        </ButtonGroup>
      </ChatProvider>
    ),
  ],
  parameters: { layout: "centered" },
} satisfies Meta<typeof ModelSelector>;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * The composer's model picker with a loaded catalog: the visible selection
 * initializes from the API's own default model id, so the user always sees
 * which model will answer.
 *
 * @summary selection initialized from the API default model
 */
export const Basic: Story = {
  tags: ["ai-generated"],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await waitFor(async () => {
      await expect(canvas.getByRole("combobox").textContent).toContain(
        "Model Two",
      );
    });
  },
};

/**
 * Catalog still loading: the trigger stays enabled and openable, showing
 * skeleton rows rather than blocking the composer behind a spinner.
 *
 * @summary openable with skeleton rows while the catalog loads
 */
export const Loading: Story = {
  tags: ["ai-generated"],
  // Runs after meta.beforeEach, so this override wins for this story only.
  beforeEach: () => {
    useModelsQuery.mockReturnValue({
      data: undefined,
      isError: false,
      isPending: true,
    });
  },
  play: async ({ canvasElement }) => {
    const trigger = within(canvasElement).getByRole("combobox");
    await expect(trigger).toBeEnabled();

    await userEvent.click(trigger);

    // The picker is portalled, so query the document, not the canvas.
    await waitFor(async () => {
      await expect(
        document.querySelectorAll('[data-slot="skeleton"]').length,
      ).toBeGreaterThan(0);
    });
  },
};
