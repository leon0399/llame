import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { SidebarMenu, SidebarMenuItem } from "@workspace/ui/components/sidebar";
import { expect, userEvent, waitFor, within } from "storybook/test";
import { vi, type MockInstance } from "vitest";

import { SidebarRowTitle } from "./sidebar-row-title";

const LONG_TITLE = "A very long chat title that overflows its row";

let warn: MockInstance<typeof console.warn>;

/** The title's text and the box that clips it. */
function titleParts(canvasElement: HTMLElement, text: string) {
  const node = within(canvasElement).getByText(text);
  // SAFETY: SidebarRowTitle always renders its text span inside its clip span.
  const clip = node.parentElement as HTMLElement;
  return { node, clip };
}

/** Lands the row's scroll now rather than at reading speed. */
function finishScroll(node: HTMLElement) {
  for (const animation of node.getAnimations()) animation.finish();
}

const meta = {
  component: SidebarRowTitle,
  tags: ["autodocs"],
  // A sidebar row as the chat list builds one: the title inside the row's
  // link, in a rail narrow enough to cut a long title short. The test
  // browser's pointer rests at the page's top-left corner, and Chromium
  // hovers whatever sits under it; the rail's padding keeps the row out from
  // under it, so the row stays at rest until a story focuses it.
  render: (args) => (
    <div className="p-2">
      <SidebarMenu className="w-48">
        <SidebarMenuItem>
          <a href="#chat" className="flex min-w-0 rounded-md p-2 text-sm">
            <SidebarRowTitle {...args} />
          </a>
        </SidebarMenuItem>
      </SidebarMenu>
    </div>
  ),
} satisfies Meta<typeof SidebarRowTitle>;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * A title too long for its row is cut short at rest, with the whole title in
 * its tooltip and its link's name. Focusing the row scrolls the title to its
 * end.
 *
 * @summary a clipped title: full tooltip, scrolls to its end on focus
 */
export const Clipped: Story = {
  tags: ["ai-generated"],
  args: { text: LONG_TITLE },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const link = canvas.getByRole("link", { name: LONG_TITLE });

    await expect(await canvas.findByTitle(LONG_TITLE)).toBeVisible();
    const { node, clip } = titleParts(canvasElement, LONG_TITLE);
    // At rest the title's tail runs past the visible box.
    await expect(node.getBoundingClientRect().right).toBeGreaterThan(
      clip.getBoundingClientRect().right + 1,
    );

    await userEvent.tab();
    await expect(link).toHaveFocus();
    finishScroll(node);

    // Its end has scrolled into view, flush with the box's trailing edge.
    await expect(
      Math.abs(
        node.getBoundingClientRect().right - clip.getBoundingClientRect().right,
      ),
    ).toBeLessThan(1);
    await expect(node.getBoundingClientRect().left).toBeLessThan(
      clip.getBoundingClientRect().left,
    );
  },
};

/**
 * A title that fits its row shows whole, has no tooltip, and stays put when
 * the row takes focus.
 *
 * @summary a title that fits: no tooltip, no scroll
 */
export const Fits: Story = {
  tags: ["ai-generated"],
  args: { text: "Fits fine" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const link = canvas.getByRole("link", { name: "Fits fine" });
    const { node, clip } = titleParts(canvasElement, "Fits fine");
    // The row has measured the title once it marks whether it is clipped.
    await waitFor(() => expect(clip).toHaveAttribute("data-clipped"));

    await expect(canvas.queryByTitle("Fits fine")).not.toBeInTheDocument();
    await expect(node.getBoundingClientRect().right).toBeLessThanOrEqual(
      clip.getBoundingClientRect().right,
    );
    await expect(node.getAnimations()).toHaveLength(0);

    const restingLeft = node.getBoundingClientRect().left;
    await userEvent.tab();
    await expect(link).toHaveFocus();
    finishScroll(node);

    await expect(node.getBoundingClientRect().left).toBe(restingLeft);
  },
};

/**
 * A title standing in for a name a run is still producing sweeps a shimmer
 * across its text, and keeps its text as the link's name.
 *
 * @summary an in-progress placeholder title that shimmers
 */
export const Shimmer: Story = {
  tags: ["ai-generated"],
  args: { text: "Generating…", shimmer: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(
      canvas.getByRole("link", { name: "Generating…" }),
    ).toBeVisible();
    const { node } = titleParts(canvasElement, "Generating…");
    await expect(
      node.getAnimations().map((animation) => animation.playState),
    ).toContain("running");
  },
};

/**
 * Rendered outside a sidebar row, the title has no row to take hover and focus
 * from, so it warns in development.
 *
 * @summary outside a sidebar row: a development warning
 */
export const OutsideARow: Story = {
  tags: ["ai-generated"],
  args: { text: "Loose title" },
  beforeEach: () => {
    warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    return () => {
      warn.mockRestore();
    };
  },
  render: (args) => (
    <div className="w-48 text-sm">
      <SidebarRowTitle {...args} />
    </div>
  ),
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByText("Loose title")).toBeVisible();
    await waitFor(() =>
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining("must render inside a SidebarMenuItem"),
      ),
    );
  },
};
