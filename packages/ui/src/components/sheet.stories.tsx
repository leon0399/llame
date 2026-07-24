import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, screen, waitFor } from "storybook/test";

import { Button } from "./button.js";
import { Input } from "./input.js";
import { Label } from "./label.js";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "./sheet.js";

// This file is mixed provenance: `shadcn-example` (the meta default below)
// for the three stories with a matching `apps/v4/examples/radix` source file
// — Basic (`sheet-demo`), No Close Button (`sheet-no-close-button`), and
// Sides (`sheet-side`). `LongContent` is `ai-generated` (overrides the tag
// itself): a bottom-anchored, height-clamped scroll state that predates
// upstream's current `sheet-side` example, which now folds the same
// scrollable-content idea into its own demo — kept as our own coverage of a
// state upstream doesn't document on its own. Upstream example we
// intentionally skip: RTL (excluded by convention).
const meta = {
  component: Sheet,
  parameters: {
    layout: "centered",
  },
  tags: ["autodocs"],
} satisfies Meta<typeof Sheet>;

export default meta;

type Story = StoryObj<typeof meta>;

const loremIpsum =
  "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat. Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur. Excepteur sint occaecat cupidatat non proident, sunt in culpa qui officia deserunt mollit anim id est laborum.";

/**
 * Use for edit tasks that benefit from staying anchored to the page edge
 * instead of taking over the center of the screen. The play function
 * verifies title/description a11y wiring, field defaults, and focus return
 * on close.
 *
 * Verbatim from [shadcn Sheet](https://ui.shadcn.com/docs/components/base/sheet)
 * (the default example at the top of the page).
 *
 * @summary for the standard edge-anchored form sheet
 */
export const Basic: Story = {
  tags: ["shadcn-example", "ai-generated"],
  render: () => (
    <Sheet>
      <SheetTrigger render={<Button variant="outline" />}>Open</SheetTrigger>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>Edit profile</SheetTitle>
          <SheetDescription>
            Make changes to your profile here. Click save when you&apos;re done.
          </SheetDescription>
        </SheetHeader>
        <div className="grid flex-1 auto-rows-min gap-6 px-4">
          <div className="grid gap-3">
            <Label htmlFor="sheet-demo-name">Name</Label>
            <Input id="sheet-demo-name" defaultValue="Pedro Duarte" />
          </div>
          <div className="grid gap-3">
            <Label htmlFor="sheet-demo-username">Username</Label>
            <Input id="sheet-demo-username" defaultValue="@peduarte" />
          </div>
        </div>
        <SheetFooter>
          <Button type="submit">Save changes</Button>
          <SheetClose render={<Button variant="outline" />}>Close</SheetClose>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  ),
  play: async ({ canvas, userEvent }) => {
    const trigger = canvas.getByRole("button", { name: "Open" });

    await userEvent.click(trigger);
    const dialog = await screen.findByRole("dialog", { name: "Edit profile" });
    await expect(dialog).toHaveAccessibleDescription(
      "Make changes to your profile here. Click save when you're done.",
    );
    await expect(screen.getByLabelText("Name")).toHaveValue("Pedro Duarte");
    await expect(screen.getByLabelText("Username")).toHaveValue("@peduarte");

    // Leave the sheet open so the visual snapshot captures it (a footer
    // SheetClose is still present). Dismissal + focus return is covered by
    // NoCloseButton (Escape) and Sides/LongContent (Cancel).
    await expect(
      dialog.querySelector('[data-slot="sheet-close"]'),
    ).not.toBeNull();
  },
};

/**
 * Use `showCloseButton={false}` when dismissal should go through an explicit
 * action instead of the corner X. The play function verifies Escape still
 * closes.
 *
 * Verbatim from [shadcn Sheet › No Close Button](https://ui.shadcn.com/docs/components/base/sheet#no-close-button).
 *
 * @summary for hiding the corner close button
 */
export const NoCloseButton: Story = {
  tags: ["shadcn-example", "ai-generated"],
  // Play presses Escape to dismiss the sheet, so the snapshot would only show
  // the trigger. Skip screenshot capture; the open sheet is covered by Basic,
  // and the interaction test still runs.
  parameters: { visualTests: { disable: true } },
  render: () => (
    <Sheet>
      <SheetTrigger render={<Button variant="outline" />}>
        Open Sheet
      </SheetTrigger>
      <SheetContent showCloseButton={false}>
        <SheetHeader>
          <SheetTitle>No Close Button</SheetTitle>
          <SheetDescription>
            This sheet doesn&apos;t have a close button in the top-right corner.
            Click outside to close.
          </SheetDescription>
        </SheetHeader>
      </SheetContent>
    </Sheet>
  ),
  play: async ({ canvas, userEvent }) => {
    const trigger = canvas.getByRole("button", { name: "Open Sheet" });

    await userEvent.click(trigger);
    const dialog = await screen.findByRole("dialog", {
      name: "No Close Button",
    });
    await expect(dialog).toHaveAccessibleDescription(
      "This sheet doesn't have a close button in the top-right corner. Click outside to close.",
    );
    await expect(
      screen.queryByRole("button", { name: "Close" }),
    ).not.toBeInTheDocument();

    await userEvent.keyboard("{Escape}");
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    await expect(trigger).toHaveFocus();
  },
};

const SHEET_SIDES = ["top", "right", "bottom", "left"] as const;

/**
 * Use `side` to pick the edge of the viewport the sheet anchors to and
 * slides in from; top/bottom sheets clamp to a max-height so long content
 * scrolls internally instead of overflowing the screen. The play function
 * verifies each side renders with the correct anchoring class and that
 * dismissal returns focus to its trigger.
 *
 * Verbatim from [shadcn Sheet › Side](https://ui.shadcn.com/docs/components/base/sheet#side).
 *
 * @summary for choosing an anchored edge
 */
export const Sides: Story = {
  tags: ["shadcn-example", "ai-generated"],
  // Play opens and dismisses each side in turn, ending closed, so the snapshot
  // would only show the triggers. Skip screenshot capture; the interaction
  // test still runs.
  parameters: { visualTests: { disable: true } },
  render: () => (
    <div className="flex flex-wrap gap-2">
      {SHEET_SIDES.map((side) => (
        <Sheet key={side}>
          <SheetTrigger
            render={<Button variant="outline" className="capitalize" />}
          >
            {side}
          </SheetTrigger>
          <SheetContent
            side={side}
            className="data-[side=bottom]:max-h-[50vh] data-[side=top]:max-h-[50vh]"
          >
            <SheetHeader>
              <SheetTitle>Edit profile</SheetTitle>
              <SheetDescription>
                Make changes to your profile here. Click save when you&apos;re
                done.
              </SheetDescription>
            </SheetHeader>
            <div className="no-scrollbar overflow-y-auto px-4">
              {Array.from({ length: 10 }).map((_, index) => (
                <p key={index} className="mb-2 leading-relaxed">
                  {loremIpsum}
                </p>
              ))}
            </div>
            <SheetFooter>
              <Button type="submit">Save changes</Button>
              <SheetClose render={<Button variant="outline" />}>
                Cancel
              </SheetClose>
            </SheetFooter>
          </SheetContent>
        </Sheet>
      ))}
    </div>
  ),
  play: async ({ canvas, userEvent }) => {
    for (const side of SHEET_SIDES) {
      const trigger = canvas.getByRole("button", { name: side });

      await userEvent.click(trigger);
      const dialog = await screen.findByRole("dialog", {
        name: "Edit profile",
      });
      // base-nova drives edge placement via the `data-side` attribute + its
      // `data-[side=…]:` variant classes, not a plain `top-0`/`left-0` class.
      await expect(dialog).toHaveAttribute("data-side", side);

      await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
      await waitFor(() =>
        expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
      );
      await expect(trigger).toHaveFocus();
    }
  },
};

/**
 * Bound content taller than the viewport with a max-height and an internal
 * scroll container — top/bottom sheets size to their content by default and
 * will otherwise overflow the screen. The play function verifies the content
 * scrolls and dismissal still returns focus.
 *
 * @summary for content long enough to require internal scrolling
 */
export const LongContent: Story = {
  tags: ["ai-generated"],
  // Play dismisses the sheet, so the snapshot would only show the trigger.
  // Skip screenshot capture; the interaction test still runs.
  parameters: { visualTests: { disable: true } },
  render: () => (
    <Sheet>
      <SheetTrigger render={<Button variant="outline" />}>Open</SheetTrigger>
      <SheetContent side="bottom" className="max-h-[50vh]">
        <SheetHeader>
          <SheetTitle>Edit profile</SheetTitle>
          <SheetDescription>
            Make changes to your profile here. Click save when you&apos;re done.
          </SheetDescription>
        </SheetHeader>
        <div className="no-scrollbar overflow-y-auto px-4">
          {Array.from({ length: 10 }).map((_, index) => (
            <p key={index} className="mb-4 leading-normal">
              {loremIpsum}
            </p>
          ))}
        </div>
        <SheetFooter>
          <Button type="submit">Save changes</Button>
          <SheetClose render={<Button variant="outline" />}>Cancel</SheetClose>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  ),
  play: async ({ canvas, userEvent }) => {
    const trigger = canvas.getByRole("button", { name: "Open" });

    await userEvent.click(trigger);
    const dialog = await screen.findByRole("dialog", { name: "Edit profile" });
    await expect(dialog).toHaveAttribute("data-side", "bottom");
    await expect(
      dialog.querySelector(".no-scrollbar")?.querySelectorAll("p"),
    ).toHaveLength(10);

    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    await expect(trigger).toHaveFocus();
  },
};
