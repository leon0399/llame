import * as React from "react";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";
import { vi } from "vitest";

import { ButtonGroup } from "@workspace/ui/components/button-group";

import { ChatProvider, useChatContext } from "@/contexts/chat-context";
// Import via the REAL specifier: sb.mock (preview.tsx) redirects it to the
// __mocks__ module, so this is the SAME hook instance the component reads.
import * as modelQueries from "@/lib/services/models/queries";
import type { ModelsResponse } from "@/lib/services/models/queries";
import type { ChatModelSelectionResponse } from "@/lib/api/generated/models";
import { ModelSelector } from "./model-selector";

const useModelsQuery = vi.mocked(modelQueries.useModelsQuery, {
  partial: true,
});

const CATALOG: ModelsResponse = {
  defaultSelector: "system:openai:model-two",
  models: [
    {
      id: "system:openai:model-one",
      source: "system",
      name: "Model One",
      contextWindowTokens: 128_000,
      input: ["text"],
    },
    {
      id: "system:openai:model-two",
      source: "system",
      name: "Model Two",
      contextWindowTokens: 400_000,
      input: ["text"],
    },
  ],
  roles: [],
};

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
 * initializes from the API's own default selector, so the user always sees
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

/** A catalog with one role chaining two models, plus a lone model. */
const ROLE_CATALOG: ModelsResponse = {
  defaultSelector: "@coding",
  models: [
    ...CATALOG.models,
    {
      id: "system:openai:codex",
      source: "system",
      name: "Codex",
      contextWindowTokens: 400_000,
      input: ["text"],
    },
  ],
  roles: [
    {
      selector: "@coding",
      candidates: [
        { modelId: "system:openai:codex", paid: false },
        { modelId: "system:openai:model-one", paid: true },
      ],
    },
  ],
};

/** Registers a Chat's stored selection, as the chat page's Chat read does. */
function StoredSelection({
  selection,
  children,
}: {
  selection: ChatModelSelectionResponse;
  children: React.ReactNode;
}) {
  const { registerChatSelection } = useChatContext();

  React.useEffect(
    () => registerChatSelection("story-chat", selection, true),
    [registerChatSelection, selection],
  );

  return children;
}

/**
 * The picker lists the configured roles before the models: a role row names
 * its selector and the chain its candidates form.
 *
 * @summary roles are listed before models
 */
export const Roles: Story = {
  tags: ["ai-generated"],
  beforeEach: () => {
    useModelsQuery.mockReturnValue({
      data: ROLE_CATALOG,
      isError: false,
      isPending: false,
    });
  },
  play: async ({ canvasElement }) => {
    const trigger = within(canvasElement).getByRole("combobox");
    await waitFor(async () => {
      await expect(trigger.textContent).toContain("@coding");
    });

    await userEvent.click(trigger);

    const picker = await within(document.body).findByLabelText("Model picker");
    await waitFor(async () => {
      await expect(within(picker).getByText("@coding")).toBeVisible();
      await expect(within(picker).getByText("Model One")).toBeVisible();
    });
  },
};

/**
 * Picking a role sets the selection to the role selector itself, so the next
 * send names `@coding` rather than a model id.
 *
 * @summary a role pick shows the role selector
 */
export const PickingARole: Story = {
  tags: ["ai-generated"],
  beforeEach: () => {
    useModelsQuery.mockReturnValue({
      data: ROLE_CATALOG,
      isError: false,
      isPending: false,
    });
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("combobox"));

    await userEvent.click(
      await within(document.body).findByRole("option", { name: "@coding" }),
    );

    await waitFor(async () => {
      await expect(
        canvas.getByRole("combobox", { name: "Select model, @coding" }),
      ).toBeVisible();
    });

    // The picker stays mounted through its exit transition, and the hidden
    // focus guards Base UI parks beside its trigger outlive it by a frame or
    // two — long enough for the a11y run to sample them. Wait teardown out.
    await waitFor(
      () => {
        expect(
          document.querySelectorAll("[data-base-ui-focus-guard]"),
        ).toHaveLength(0);
      },
      { timeout: 5000 },
    );
  },
};

/**
 * A held Chat shows the role, the held model, and the local time the Chat
 * returns to the role — the spec's "A held Chat in the picker".
 *
 * @summary a held Chat shows its role, held model, and revert time
 */
export const HeldChatInPicker: Story = {
  tags: ["ai-generated"],
  decorators: [
    (Story) => (
      <ChatProvider>
        <StoredSelection
          selection={{
            selector: "@coding",
            effort: null,
            hold: {
              selector: "@coding",
              modelId: "system:openai:model-one",
              effort: null,
              revertAt: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
            },
          }}
        >
          <ButtonGroup>
            <Story />
          </ButtonGroup>
        </StoredSelection>
      </ChatProvider>
    ),
  ],
  beforeEach: () => {
    useModelsQuery.mockReturnValue({
      data: ROLE_CATALOG,
      isError: false,
      isPending: false,
    });
  },
  play: async ({ canvasElement }) => {
    const trigger = within(canvasElement).getByRole("combobox");

    await waitFor(async () => {
      await expect(trigger.getAttribute("aria-label")).toMatch(
        /^Select model, @coding → Model One until \d{2}:\d{2}$/u,
      );
    });
  },
};
