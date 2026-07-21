import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, screen, waitFor } from "storybook/test";

import { Button } from "./button.js";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "./dialog.js";
import { Field, FieldGroup } from "./field.js";
import { Input } from "./input.js";
import { Label } from "./label.js";

// All five stories below are transcribed from the shadcn Dialog docs
// (https://ui.shadcn.com/docs/components/base/dialog), so the file carries
// the "shadcn-example" provenance tag on each transcribed story. These examples use
// only the standard `<Dialog>`/`<DialogContent>` public API (incl. our
// vendored `showCloseButton` and `Field`/`FieldGroup`), which our
// `dialog.tsx` fully supports — the upstream `apps/v4/examples/radix/`
// source composes the same public component API regardless of which style
// registry the docs preview under, so "radix-nova"-only availability does
// not make an example incompatible (see packages/ui/AGENTS.md). Upstream
// example we intentionally skip: RTL (excluded by convention).
const meta = {
  component: Dialog,
  parameters: {
    layout: "centered",
  },
  tags: ["autodocs"],
} satisfies Meta<typeof Dialog>;

export default meta;

type Story = StoryObj<typeof meta>;

const loremIpsum =
  "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat. Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur. Excepteur sint occaecat cupidatat non proident, sunt in culpa qui officia deserunt mollit anim id est laborum.";

/**
 * Use for focused form tasks; the play function verifies title/description
 * a11y wiring, field defaults, and focus return on cancel.
 *
 * Verbatim from [shadcn Dialog](https://ui.shadcn.com/docs/components/base/dialog)
 * (the default example at the top of the page).
 *
 * @summary for the standard form dialog
 */
export const Basic: Story = {
  tags: ["shadcn-example", "ai-generated"],
  render: () => (
    <Dialog>
      <form>
        <DialogTrigger asChild>
          <Button variant="outline">Open Dialog</Button>
        </DialogTrigger>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Edit profile</DialogTitle>
            <DialogDescription>
              Make changes to your profile here. Click save when you&apos;re
              done.
            </DialogDescription>
          </DialogHeader>
          <FieldGroup>
            <Field>
              <Label htmlFor="name-1">Name</Label>
              <Input id="name-1" name="name" defaultValue="Pedro Duarte" />
            </Field>
            <Field>
              <Label htmlFor="username-1">Username</Label>
              <Input id="username-1" name="username" defaultValue="@peduarte" />
            </Field>
          </FieldGroup>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline">Cancel</Button>
            </DialogClose>
            <Button type="submit">Save changes</Button>
          </DialogFooter>
        </DialogContent>
      </form>
    </Dialog>
  ),
  play: async ({ canvas, userEvent }) => {
    const trigger = canvas.getByRole("button", { name: "Open Dialog" });

    await userEvent.click(trigger);
    const dialog = await screen.findByRole("dialog", { name: "Edit profile" });
    await expect(dialog).toHaveAccessibleDescription(
      "Make changes to your profile here. Click save when you're done.",
    );
    await expect(screen.getByLabelText("Name")).toHaveValue("Pedro Duarte");
    await expect(screen.getByLabelText("Username")).toHaveValue("@peduarte");

    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    await expect(trigger).toHaveFocus();
  },
};

/**
 * Use a footer close action when a single explicit dismissal reads better
 * than the corner X (e.g. share/info dialogs).
 *
 * Verbatim from [shadcn Dialog › Custom Close Button](https://ui.shadcn.com/docs/components/base/dialog#custom-close-button).
 *
 * @summary for footer-driven dismissal
 */
export const CustomCloseButton: Story = {
  tags: ["shadcn-example", "ai-generated"],
  render: () => (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="outline">Share</Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Share link</DialogTitle>
          <DialogDescription>
            Anyone who has this link will be able to view this.
          </DialogDescription>
        </DialogHeader>
        <div className="flex items-center gap-2">
          <div className="grid flex-1 gap-2">
            <Label htmlFor="link" className="sr-only">
              Link
            </Label>
            <Input
              id="link"
              defaultValue="https://ui.shadcn.com/docs/installation"
              readOnly
            />
          </div>
        </div>
        <DialogFooter className="sm:justify-start">
          <DialogClose asChild>
            <Button type="button">Close</Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  ),
  play: async ({ canvas, userEvent }) => {
    const trigger = canvas.getByRole("button", { name: "Share" });

    await userEvent.click(trigger);
    const dialog = await screen.findByRole("dialog", { name: "Share link" });
    await expect(dialog).toHaveAccessibleDescription(
      "Anyone who has this link will be able to view this.",
    );
    await expect(screen.getByLabelText("Link")).toHaveValue(
      "https://ui.shadcn.com/docs/installation",
    );

    await userEvent.click(
      dialog.querySelector<HTMLButtonElement>(
        '[data-slot="dialog-footer"] button',
      )!,
    );
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    await expect(trigger).toHaveFocus();
  },
};

/**
 * Use `showCloseButton={false}` when dismissal must go through an explicit
 * action; the play function verifies Escape still closes.
 *
 * Verbatim from [shadcn Dialog › No Close Button](https://ui.shadcn.com/docs/components/base/dialog#no-close-button).
 *
 * @summary for hiding the corner close button
 */
export const NoCloseButton: Story = {
  tags: ["shadcn-example", "ai-generated"],
  render: () => (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="outline">No Close Button</Button>
      </DialogTrigger>
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>No Close Button</DialogTitle>
          <DialogDescription>
            This dialog doesn&apos;t have a close button in the top-right
            corner.
          </DialogDescription>
        </DialogHeader>
      </DialogContent>
    </Dialog>
  ),
  play: async ({ canvas, userEvent }) => {
    const trigger = canvas.getByRole("button", { name: "No Close Button" });

    await userEvent.click(trigger);
    await expect(
      await screen.findByRole("dialog", { name: "No Close Button" }),
    ).toHaveAccessibleDescription(
      "This dialog doesn't have a close button in the top-right corner.",
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

/**
 * Use when long content needs persistent actions — the footer stays visible
 * while the body scrolls.
 *
 * Adapted from [shadcn Dialog › Sticky Footer](https://ui.shadcn.com/docs/components/base/dialog#sticky-footer)
 * (adds `tabIndex={0}` to the scrollable region so it's keyboard-operable,
 * satisfying our stricter a11y gate).
 *
 * @summary for long content with persistent actions
 */
export const StickyFooter: Story = {
  tags: ["shadcn-example", "ai-generated"],
  render: () => (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="outline">Sticky Footer</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Sticky Footer</DialogTitle>
          <DialogDescription>
            This dialog has a sticky footer that stays visible while the content
            scrolls.
          </DialogDescription>
        </DialogHeader>
        <div
          className="-mx-4 no-scrollbar max-h-[50vh] overflow-y-auto px-4"
          tabIndex={0}
        >
          {Array.from({ length: 10 }).map((_, index) => (
            <p key={index} className="mb-4 leading-normal">
              {loremIpsum}
            </p>
          ))}
        </div>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline">Close</Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  ),
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(
      canvas.getByRole("button", { name: "Sticky Footer" }),
    );

    const dialog = await screen.findByRole("dialog", { name: "Sticky Footer" });
    await expect(dialog).toHaveAccessibleDescription(
      "This dialog has a sticky footer that stays visible while the content scrolls.",
    );
    await expect(
      dialog.querySelector(".no-scrollbar")?.querySelectorAll("p"),
    ).toHaveLength(10);
    await waitFor(() =>
      expect(
        dialog.querySelector('[data-slot="dialog-footer"] button'),
      ).toBeVisible(),
    );
  },
};

/**
 * Use a scrollable body for long informational content with no footer
 * actions.
 *
 * Adapted from [shadcn Dialog › Scrollable Content](https://ui.shadcn.com/docs/components/base/dialog#scrollable-content)
 * (adds `tabIndex={0}` to the scrollable region so it's keyboard-operable,
 * satisfying our stricter a11y gate).
 *
 * @summary for long content without footer actions
 */
export const ScrollableContent: Story = {
  tags: ["shadcn-example", "ai-generated"],
  render: () => (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="outline">Scrollable Content</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Scrollable Content</DialogTitle>
          <DialogDescription>
            This is a dialog with scrollable content.
          </DialogDescription>
        </DialogHeader>
        <div
          className="-mx-4 no-scrollbar max-h-[50vh] overflow-y-auto px-4"
          tabIndex={0}
        >
          {Array.from({ length: 10 }).map((_, index) => (
            <p key={index} className="mb-4 leading-normal">
              {loremIpsum}
            </p>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  ),
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(
      canvas.getByRole("button", { name: "Scrollable Content" }),
    );

    const dialog = await screen.findByRole("dialog", {
      name: "Scrollable Content",
    });
    await expect(dialog).toHaveAccessibleDescription(
      "This is a dialog with scrollable content.",
    );
    await expect(
      dialog.querySelector(".no-scrollbar")?.querySelectorAll("p"),
    ).toHaveLength(10);
  },
};
