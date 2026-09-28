import * as React from "react";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";
import { vi } from "vitest";

import { ChatProvider, useChatContext } from "@/contexts/chat-context";
// Import via the REAL specifier: sb.mock (preview.tsx) redirects it to the
// __mocks__ module, so this is the SAME hook instance the component reads.
import * as permissionModeQueries from "@/lib/services/permission-modes/queries";
import type { PermissionModesResponse } from "@/lib/services/permission-modes/queries";
import { PermissionModeSelector } from "./permission-mode-selector";
import { contrastKnownIssue232 } from "@workspace/ui/components/known-a11y-issues";

const usePermissionModesQuery = vi.mocked(
  permissionModeQueries.usePermissionModesQuery,
  { partial: true },
);

const DEFAULT_ONLY = {
  modes: [{ value: "default" }],
} satisfies PermissionModesResponse;

const BOTH_MODES = {
  modes: [{ value: "default" }, { value: "bypass" }],
} satisfies PermissionModesResponse;

function BypassSelection({ children }: { children: React.ReactNode }) {
  const { setPermissionMode } = useChatContext();
  const didSet = React.useRef(false);

  React.useEffect(() => {
    if (didSet.current) return;
    didSet.current = true;
    setPermissionMode("chat-1", "bypass");
  }, [setPermissionMode]);

  return children;
}

const meta = {
  component: PermissionModeSelector,
  tags: ["autodocs"],
  args: { chatId: "chat-1" },
  beforeEach: () => {
    usePermissionModesQuery.mockReturnValue({
      data: BOTH_MODES,
      isError: false,
      isPending: false,
    });
  },
  decorators: [
    (Story) => (
      <ChatProvider>
        <div className="flex w-full items-center border-t p-1">
          <Story />
        </div>
      </ChatProvider>
    ),
  ],
  parameters: { layout: "centered" },
} satisfies Meta<typeof PermissionModeSelector>;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * The operator's default configuration exposes no choice, so the composer
 * leaves no empty selector cell behind.
 *
 * @summary hidden when only the default mode is enabled
 */
export const DefaultOnly: Story = {
  tags: ["ai-generated"],
  beforeEach: () => {
    usePermissionModesQuery.mockReturnValue({
      data: DEFAULT_ONLY,
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
 * Both operator-enabled modes appear as radio choices, with the safe default
 * selected until this chat opts into bypass.
 *
 * @summary default mode is selected with both modes available
 */
export const BothModes: Story = {
  tags: ["ai-generated"],
  // #232 — the subtle destructive trigger (`bg-destructive/10 text-destructive`)
  // falls below WCAG AA color-contrast until the token fix; every other a11y
  // rule still runs on this story.
  parameters: contrastKnownIssue232,
  play: async ({ canvas }) => {
    const trigger = canvas.getByRole("button", {
      name: "Permission mode, Default",
    });
    await expect(trigger).toHaveAttribute("data-variant", "outline");

    await userEvent.click(trigger);
    const menu = within(document.body);
    await expect(
      await menu.findByText("Applies the operator tool policy."),
    ).toBeTruthy();
    await expect(
      await menu.findByText("Skips tool-permission checks for this chat."),
    ).toBeTruthy();
    await userEvent.click(
      await menu.findByRole("menuitemradio", { name: /Bypass/ }),
    );
    await waitFor(async () => {
      const bypassTrigger = canvas.getByRole("button", {
        name: "Permission mode, Bypass",
      });
      await expect(bypassTrigger).toHaveAttribute(
        "data-variant",
        "destructive",
      );
    });
  },
};

/**
 * A chat that selected bypass keeps that selection in its in-memory context,
 * and the trigger uses the destructive treatment to make the risk visible.
 *
 * @summary bypass selection uses the destructive trigger style
 */
export const BypassSelected: Story = {
  tags: ["ai-generated"],
  parameters: contrastKnownIssue232,
  render: (args) => (
    <BypassSelection>
      <PermissionModeSelector {...args} />
    </BypassSelection>
  ),
  play: async ({ canvas }) => {
    const trigger = await waitFor(() =>
      canvas.getByRole("button", { name: "Permission mode, Bypass" }),
    );
    await expect(trigger).toHaveAttribute("data-variant", "destructive");
  },
};

/**
 * While the enabled-mode listing is still loading, the selector stays absent
 * rather than showing an unusable empty trigger.
 *
 * @summary hidden while the mode listing is loading
 */
export const Loading: Story = {
  tags: ["ai-generated"],
  beforeEach: () => {
    usePermissionModesQuery.mockReturnValue({
      data: undefined,
      isError: false,
      isPending: true,
    });
  },
  play: async ({ canvas, canvasElement }) => {
    await expect(canvas.queryByRole("button")).toBeNull();
    await expect(canvasElement.textContent).toBe("");
  },
};

/**
 * A failed capability listing is also hidden: the composer must never imply
 * that bypass is available when the API could not confirm it.
 *
 * @summary hidden when the mode listing fails
 */
export const Failed: Story = {
  tags: ["ai-generated"],
  beforeEach: () => {
    usePermissionModesQuery.mockReturnValue({
      data: undefined,
      isError: true,
      isPending: false,
    });
  },
  play: async ({ canvas, canvasElement }) => {
    await expect(canvas.queryByRole("button")).toBeNull();
    await expect(canvasElement.textContent).toBe("");
  },
};

/**
 * A background refetch may fail after the capability listing loaded. Keep the
 * selector visible so a previously selected bypass remains visible and usable.
 *
 * @summary remains visible when a background refetch fails
 */
export const BackgroundRefetchFailed: Story = {
  tags: ["ai-generated"],
  parameters: contrastKnownIssue232,
  beforeEach: () => {
    usePermissionModesQuery.mockReturnValue({
      data: BOTH_MODES,
      isError: true,
      isPending: false,
    });
  },
  render: (args) => (
    <BypassSelection>
      <PermissionModeSelector {...args} />
    </BypassSelection>
  ),
  play: async ({ canvas }) => {
    await expect(
      canvas.getByRole("button", { name: "Permission mode, Bypass" }),
    ).toBeTruthy();
  },
};
