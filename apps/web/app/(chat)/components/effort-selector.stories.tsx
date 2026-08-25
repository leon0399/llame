import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";
import { vi } from "vitest";

import { ButtonGroup } from "@workspace/ui/components/button-group";
import { SendIcon } from "lucide-react";

import { ChatProvider } from "@/contexts/chat-context";
// Import via the REAL specifier: sb.mock (preview.tsx) redirects it to the
// __mocks__ module, so this is the SAME hook instance the component reads.
import * as modelQueries from "@/lib/services/models/queries";
import type { AvailableModel } from "@/lib/services/models/queries";
import { EffortSelector } from "./effort-selector";
import { PromptInputButton } from "./prompt-input";

const useModelsQuery = vi.mocked(modelQueries.useModelsQuery, {
  partial: true,
});

const REASONING_MODEL: AvailableModel = {
  id: "system:openai:reasoner",
  source: "system",
  name: "Reasoner",
  contextWindowTokens: 400_000,
  reasoning: {
    // Deliberately mixed-shape tokens: levels are opaque provider strings, and
    // the UI must render whatever the operator configured rather than a set it
    // recognises.
    effortLevels: ["none", "low", "medium", "high", "xhigh"],
    defaultEffort: "medium",
    cacheInvalidatedByEffortChange: true,
  },
};

const PLAIN_MODEL: AvailableModel = {
  id: "system:openai:plain",
  source: "system",
  name: "Plain",
  contextWindowTokens: 128_000,
};

function catalog(model: AvailableModel) {
  return { defaultModelId: model.id, models: [model] };
}

const meta = {
  component: EffortSelector,
  tags: ["autodocs"],
  beforeEach: () => {
    useModelsQuery.mockReturnValue({
      data: catalog(REASONING_MODEL),
      isError: false,
      isPending: false,
    });
  },
  decorators: [
    (Story) => (
      <ChatProvider>
        {/* The real composer wrapper, so the cell is previewed with the border
            collapsing and corner rounding it actually ships with. */}
        <ButtonGroup>
          <Story />
        </ButtonGroup>
      </ChatProvider>
    ),
  ],
  parameters: { layout: "centered" },
} satisfies Meta<typeof EffortSelector>;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * The composer's effort control on a model that declares a vocabulary. The
 * trigger opens showing the model's own `defaultEffort`, rendered verbatim —
 * levels are opaque provider identifiers, so the UI never prettifies them.
 *
 * @summary trigger seeded from the model's declared default effort
 */
export const Basic: Story = {
  tags: ["ai-generated"],
  play: async ({ canvas }) => {
    await waitFor(async () => {
      await expect(canvas.getByRole("button").textContent).toContain("medium");
    });
  },
};

/**
 * Mounted with nothing selected yet — no ModelSelector has seeded the context.
 * The control must still resolve the catalog's own `defaultModelId`; it
 * previously rendered nothing here, because it depended on another
 * component's seeding effect rather than on the catalog data.
 *
 * @summary resolves the catalog default when no model is selected yet
 */
export const NoModelSelectedYet: Story = {
  tags: ["ai-generated"],
  play: async ({ canvas }) => {
    await waitFor(async () => {
      await expect(canvas.getByRole("button").textContent).toContain("medium");
    });
  },
};

/**
 * A model that declares no `reasoning` object accepts no effort at all, so the
 * control renders nothing — including its seam, leaving the composer pill
 * intact rather than showing a disabled or empty cell.
 *
 * @summary renders nothing for a model without a reasoning vocabulary
 */
export const NoReasoningVocabulary: Story = {
  tags: ["ai-generated"],
  beforeEach: () => {
    useModelsQuery.mockReturnValue({
      data: catalog(PLAIN_MODEL),
      isError: false,
      isPending: false,
    });
  },
  play: async ({ canvas, canvasElement }) => {
    // Nothing at all: no trigger, and no seam left stranded without it.
    await expect(canvas.queryByRole("button")).toBeNull();
    await expect(canvasElement.textContent).toBe("");
  },
};

/**
 * Dragging the slider updates the trigger label live, before the popup is
 * dismissed — the point of a slider here is that the trade-off is legible
 * while choosing, not only after committing.
 *
 * @summary slider selection updates the trigger label live
 */
export const SelectsWithKeyboard: Story = {
  tags: ["ai-generated"],
  play: async ({ canvas }) => {
    const trigger = canvas.getByRole("button");
    await waitFor(async () => {
      await expect(trigger.textContent).toContain("medium");
    });

    await userEvent.click(trigger);

    // The popup is portalled, so query the document rather than the canvas.
    // By ROLE: the primitive renders a nested `<input type="range">`, whose
    // implicit role is `slider` — querying the role survives a markup change
    // that a tag selector would not.
    const slider = await within(document.body).findByRole("slider");

    slider.focus();
    // One step toward "Smarter" — medium -> high in the configured order.
    await userEvent.keyboard("{ArrowRight}");

    await waitFor(async () => {
      await expect(trigger.textContent).toContain("high");
    });
  },
};

/**
 * The composer's real shape: the selectors attached to each other, and send
 * standing apart. Every control is still one height — they drifted apart once
 * (triggers at `sm` = h-7 beside a `size-8` send) — so this pins the
 * invariant rather than a pixel value, and survives a deliberate resize.
 *
 * Send sits outside the group so it keeps symmetric corners; as the group's
 * last cell it was forced `rounded-r-lg` with a squared left edge, which made
 * the paper-plane glyph read off-centre.
 *
 * @summary composer controls share one height across both units
 */
export const CellsShareOneHeight: Story = {
  tags: ["ai-generated"],
  decorators: [
    (Story) => (
      <ChatProvider>
        <div className="flex items-center gap-2">
          <ButtonGroup>
            <Story />
          </ButtonGroup>
          {/* The REAL send cell, with the props chat-page passes it. A
              hand-built stand-in would keep passing if the shipped button
              drifted, which is the regression this story exists to catch. */}
          <PromptInputButton
            variant="default"
            size="icon"
            type="submit"
            aria-label="Send message"
          >
            <SendIcon size={16} />
          </PromptInputButton>
        </div>
      </ChatProvider>
    ),
  ],
  play: async ({ canvas }) => {
    const heights = canvas
      .getAllByRole("button")
      .map((cell) => cell.getBoundingClientRect().height);

    await expect(heights.length).toBeGreaterThan(1);
    await expect(new Set(heights).size).toBe(1);
  },
};

/**
 * The ends of the scale are labelled by the trade-off rather than by the
 * extreme level names: those are per-model tokens and would be wrong the
 * moment another model is selected.
 *
 * @summary scale ends labelled Faster and Smarter, not level names
 */
export const ScaleEndsAreLabelled: Story = {
  tags: ["ai-generated"],
  play: async ({ canvas }) => {
    await userEvent.click(canvas.getByRole("button"));

    await waitFor(async () => {
      await expect(document.body.textContent).toContain("Faster");
      await expect(document.body.textContent).toContain("Smarter");
    });
  },
};
