import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";

import { contrastKnownIssue232 } from "@workspace/ui/components/known-a11y-issues";

import { ShortcutsSection } from "./shortcuts-section";

/*
 * The shortcut settings page as Leo reviewed it: key caps with a pencil for a
 * changeable shortcut and a lock for a fixed one; recording the next keys,
 * refusing ones no binding may use or a fixed shortcut owns, and offering a
 * swap for keys another changeable shortcut owns. Chromium in the runner is
 * not a Mac, so the primary modifier reads "Ctrl".
 */

const meta = {
  component: ShortcutsSection,
  tags: ["autodocs"],
  // Kbd's muted ink on its muted fill is the tracked #232 contrast defect.
  parameters: { layout: "padded", ...contrastKnownIssue232 },
  // Bindings persist in localStorage, which later story files share: leave
  // the defaults behind.
  afterEach: async ({ canvasElement }) => {
    await startFresh(canvasElement);
  },
} satisfies Meta<typeof ShortcutsSection>;

export default meta;

type Story = StoryObj<typeof meta>;

/** The bindings store is module state shared by every story of this file:
 *  reset it through the page's own buttons so each story starts from the
 *  defaults. */
async function startFresh(canvasElement: HTMLElement) {
  const canvas = within(canvasElement);

  await userEvent.click(
    canvas.getByRole("button", { name: "Reset all shortcuts" }),
  );
  await userEvent.click(
    canvas.getByRole("button", { name: "Clear usage counts" }),
  );

  return canvas;
}

/** The row of one shortcut, found by its label. */
function row(canvasElement: HTMLElement, label: string) {
  const item = within(canvasElement).getByText(label).closest("li");

  if (item === null) throw new Error(`expected a row for ${label}`);

  return within(item);
}

/** The row's key caps, in order. */
function keyCaps(canvasElement: HTMLElement, label: string) {
  const item = within(canvasElement).getByText(label).closest("li");

  return Array.from(item?.querySelectorAll("kbd[data-slot=kbd]") ?? []).map(
    (kbd) => kbd.textContent,
  );
}

async function startRecording(canvasElement: HTMLElement, label: string) {
  await userEvent.click(
    row(canvasElement, label).getByRole("button", {
      name: `Change keys for ${label}`,
    }),
  );
}

/**
 * At rest: each chord as its key caps, a pencil on a changeable shortcut, and
 * a lock with "Fixed" on one that cannot change.
 *
 * @summary shortcuts at rest: key caps, pencils and locks
 */
export const Idle: Story = {
  tags: ["ai-generated"],
  play: async ({ canvasElement }) => {
    await startFresh(canvasElement);

    await expect(keyCaps(canvasElement, "Search chats and commands")).toEqual([
      "Ctrl",
      "K",
    ]);
    await expect(keyCaps(canvasElement, "New chat")).toEqual([
      "Ctrl",
      "Shift",
      "O",
    ]);
    await expect(
      row(canvasElement, "New chat").getByRole("button", {
        name: "Change keys for New chat",
      }),
    ).toBeVisible();

    const fixed = row(canvasElement, "Show or hide the sidebar");

    await expect(fixed.getByText("Fixed")).toBeVisible();
    await expect(fixed.queryByRole("button")).toBeNull();
  },
};

/**
 * The pencil records the next keys; Esc stops without changing anything.
 *
 * @summary recording, cancelled with Esc
 */
export const RecordingCancelsOnEscape: Story = {
  tags: ["ai-generated"],
  play: async ({ canvasElement }) => {
    await startFresh(canvasElement);
    await startRecording(canvasElement, "New chat");

    const newChat = row(canvasElement, "New chat");

    await expect(newChat.getByText("Press keys…")).toBeVisible();
    await expect(
      newChat.getByText("Press the new keys. Esc cancels."),
    ).toBeVisible();

    await userEvent.keyboard("{Escape}");

    await waitFor(() =>
      expect(keyCaps(canvasElement, "New chat")).toEqual([
        "Ctrl",
        "Shift",
        "O",
      ]),
    );
    await expect(newChat.queryByText(/^Reset to/)).toBeNull();
  },
};

/**
 * A bare letter would fire while typing, so recording refuses it and keeps
 * listening.
 *
 * @summary a key without the primary modifier is refused
 */
export const BareLetterRefused: Story = {
  tags: ["ai-generated"],
  play: async ({ canvasElement }) => {
    await startFresh(canvasElement);
    await startRecording(canvasElement, "New chat");
    await userEvent.keyboard("k");

    const newChat = row(canvasElement, "New chat");

    await expect(newChat.getByText("Hold Ctrl with a key.")).toBeVisible();
    await expect(newChat.getByText("Press keys…")).toBeVisible();
  },
};

/**
 * Keys a fixed shortcut owns are refused with what they run.
 *
 * @summary a fixed shortcut's keys are refused
 */
export const FixedKeysRefused: Story = {
  tags: ["ai-generated"],
  play: async ({ canvasElement }) => {
    await startFresh(canvasElement);
    await startRecording(canvasElement, "New chat");
    await userEvent.keyboard("{Control>}b{/Control}");

    await expect(
      row(canvasElement, "New chat").getByText(
        "Ctrl+B always runs Show or hide the sidebar. Press other keys.",
      ),
    ).toBeVisible();
  },
};

/**
 * Keys another changeable shortcut owns are held for a swap: Swap keys gives
 * this shortcut those keys and the other one this shortcut's.
 *
 * @summary keys in use by another shortcut, swapped
 */
export const TakenKeysSwap: Story = {
  tags: ["ai-generated"],
  play: async ({ canvasElement }) => {
    await startFresh(canvasElement);
    await startRecording(canvasElement, "New chat");
    await userEvent.keyboard("{Control>}k{/Control}");

    const newChat = row(canvasElement, "New chat");

    await expect(
      newChat.getByText("Ctrl+K runs Search chats and commands."),
    ).toBeVisible();
    await userEvent.click(newChat.getByRole("button", { name: "Swap keys" }));

    await waitFor(() =>
      expect(keyCaps(canvasElement, "New chat")).toEqual(["Ctrl", "K"]),
    );
    await expect(keyCaps(canvasElement, "Search chats and commands")).toEqual([
      "Ctrl",
      "Shift",
      "O",
    ]);
  },
};

/**
 * A changed shortcut offers its default back in its text line.
 *
 * @summary a changed shortcut reset to its default
 */
export const ResetToDefault: Story = {
  tags: ["ai-generated"],
  play: async ({ canvasElement }) => {
    await startFresh(canvasElement);
    await startRecording(canvasElement, "New chat");
    await userEvent.keyboard("{Control>}{Shift>}y{/Shift}{/Control}");

    await waitFor(() =>
      expect(keyCaps(canvasElement, "New chat")).toEqual([
        "Ctrl",
        "Shift",
        "Y",
      ]),
    );
    await userEvent.click(
      row(canvasElement, "New chat").getByRole("button", {
        name: "Reset to Ctrl+Shift+O",
      }),
    );

    await waitFor(() =>
      expect(keyCaps(canvasElement, "New chat")).toEqual([
        "Ctrl",
        "Shift",
        "O",
      ]),
    );
  },
};
