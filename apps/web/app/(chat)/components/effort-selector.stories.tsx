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
import { ModelSelector } from "./model-selector";
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
    // Mixed bare values and labeled objects — selection stays on `value`,
    // display prefers `label` when present.
    effortLevels: [
      { value: "none" },
      { value: "low" },
      { value: "medium" },
      { value: "high" },
      { value: "xhigh", label: "Extra High" },
    ],
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

/** Declares a `reasoning` object whose vocabulary is EMPTY — the api's other
 *  way of saying this model accepts no effort. */
const EMPTY_VOCABULARY_MODEL: AvailableModel = {
  id: "system:openai:no-effort",
  source: "system",
  name: "No Effort",
  contextWindowTokens: 128_000,
  reasoning: {
    effortLevels: [],
    defaultEffort: "n/a",
    cacheInvalidatedByEffortChange: false,
  },
};

/** A second real vocabulary sharing NO level with REASONING_MODEL: `medium`
 *  does not exist here, so a carried-over selection cannot survive the
 *  switch. */
const TERSE_MODEL: AvailableModel = {
  id: "system:openai:terse",
  source: "system",
  name: "Terse",
  contextWindowTokens: 128_000,
  reasoning: {
    effortLevels: [{ value: "x" }, { value: "y", label: "Y" }],
    defaultEffort: "x",
    cacheInvalidatedByEffortChange: true,
  },
};

/** A catalog whose default model is the one listed first. */
function catalog(
  defaultModel: AvailableModel,
  ...others: Array<AvailableModel>
) {
  return { defaultModelId: defaultModel.id, models: [defaultModel, ...others] };
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
 * trigger opens showing the model's own `defaultEffort` — unlabeled values
 * render as the raw token; labeled ones use the operator label.
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
 * A labeled level drops monospace on the trigger and shows the operator
 * string rather than the raw provider token.
 *
 * @summary labeled level renders without monospace
 */
export const LabeledLevel: Story = {
  tags: ["ai-generated"],
  play: async ({ canvas }) => {
    const trigger = canvas.getByRole("button");
    await waitFor(async () => {
      await expect(trigger.textContent).toContain("medium");
    });

    await userEvent.click(trigger);
    const slider = await within(document.body).findByRole("slider");
    slider.focus();
    // medium -> high -> xhigh
    await userEvent.keyboard("{ArrowRight}{ArrowRight}");

    await waitFor(async () => {
      await expect(trigger.textContent).toContain("Extra High");
      await expect(trigger.querySelector(".font-mono")).toBeNull();
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
 * A model whose vocabulary is DECLARED but empty accepts no effort either:
 * there is a `reasoning` object, and nothing in it to choose. The control must
 * still render nothing — seeding `defaultEffort` here would set and send a
 * level the user can neither see nor drag the slider to.
 *
 * @summary renders nothing for a declared but empty vocabulary
 */
export const EmptyEffortVocabulary: Story = {
  tags: ["ai-generated"],
  beforeEach: () => {
    useModelsQuery.mockReturnValue({
      data: catalog(EMPTY_VOCABULARY_MODEL),
      isError: false,
      isPending: false,
    });
  },
  play: async ({ canvas, canvasElement }) => {
    await expect(canvas.queryByRole("button")).toBeNull();
    await expect(canvasElement.textContent).toBe("");
  },
};

/**
 * Dragging the slider updates the trigger label live, before the popup is
 * dismissed — the point of a slider here is that the trade-off is legible
 * while choosing, not only after committing. The popup carries the same level
 * in a live region, because the slider's own value is a position INDEX and
 * would be announced as a meaningless number.
 *
 * @summary slider selection updates the trigger label and the announced level
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
      // The trigger shows the same string, so the live region has to be
      // selected by the attribute that makes it one.
      await expect(
        within(document.body).getByText("high", { selector: "[aria-live]" }),
      ).toBeTruthy();
    });
  },
};

/**
 * Switching to a model that declares no effort vocabulary takes the cell out
 * of the composer. The picker drives the change because it is the only surface
 * that changes the selected model — the cell has to follow the model the user
 * actually chose, not the one the catalog started on.
 *
 * @summary switching to a model without a vocabulary removes the cell
 */
export const SwitchingToModelWithoutVocabulary: Story = {
  tags: ["ai-generated"],
  beforeEach: () => {
    useModelsQuery.mockReturnValue({
      data: catalog(REASONING_MODEL, PLAIN_MODEL),
      isError: false,
      isPending: false,
    });
  },
  decorators: [
    (Story) => (
      <ChatProvider>
        {/* The shipped composer pair in the group it ships in. */}
        <ButtonGroup>
          <ModelSelector />
          <Story />
        </ButtonGroup>
      </ChatProvider>
    ),
  ],
  play: async ({ canvas }) => {
    // Starts on the reasoning model, so there is a cell to lose.
    await waitFor(async () => {
      await expect(
        canvas.getByRole("button", { name: /Reasoning effort/ }),
      ).toBeTruthy();
    });

    await userEvent.click(canvas.getByRole("combobox"));

    // The picker is portalled, so query the document rather than the canvas.
    await userEvent.click(
      await within(document.body).findByRole("option", { name: "Plain" }),
    );

    await waitFor(async () => {
      await expect(
        canvas.queryByRole("button", { name: /Reasoning effort/ }),
      ).toBeNull();
    });

    // The picker stays mounted through its exit transition, and the hidden
    // focus guards Base UI parks beside its trigger outlive it by a frame or
    // two — long enough for the a11y run to sample them and flag them as
    // focusable inside an aria-hidden node. Wait the teardown out.
    await waitFor(() => {
      expect(
        document.querySelectorAll("[data-base-ui-focus-guard]"),
      ).toHaveLength(0);
    });
  },
};

/**
 * Switching to a model whose vocabulary does not contain the current level
 * moves the control to the NEW model's own default, not to the position the
 * old level occupied: `medium` is the reasoner's middle level and `y` is
 * Terse's last, so a positional carry-over would land on a level this model
 * never declared as its default.
 *
 * @summary a carried-over level is replaced by the new model's own default
 */
export const SwitchingModelResetsEffort: Story = {
  tags: ["ai-generated"],
  beforeEach: () => {
    useModelsQuery.mockReturnValue({
      data: catalog(REASONING_MODEL, TERSE_MODEL),
      isError: false,
      isPending: false,
    });
  },
  decorators: [
    (Story) => (
      <ChatProvider>
        <ButtonGroup>
          <ModelSelector />
          <Story />
        </ButtonGroup>
      </ChatProvider>
    ),
  ],
  play: async ({ canvas }) => {
    await waitFor(async () => {
      await expect(
        canvas.getByRole("button", { name: "Reasoning effort, medium" }),
      ).toBeTruthy();
    });

    await userEvent.click(canvas.getByRole("combobox"));
    await userEvent.click(
      await within(document.body).findByRole("option", { name: "Terse" }),
    );

    await waitFor(async () => {
      await expect(
        canvas.getByRole("button", { name: "Reasoning effort, x" }),
      ).toBeTruthy();
    });

    // As in the story above: let the picker's closed-state teardown finish
    // before the a11y run samples the DOM.
    await waitFor(() => {
      expect(
        document.querySelectorAll("[data-base-ui-focus-guard]"),
      ).toHaveLength(0);
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
            variant="outline"
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
