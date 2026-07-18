import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { BluetoothIcon, CircleFadingPlusIcon, Trash2Icon } from "lucide-react";
import { expect, screen, waitFor } from "storybook/test";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "./alert-dialog.js";
import { Button } from "./button.js";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "./dialog.js";

// This file is `shadcn-example` (the meta default below) for every story
// except `InDialog`. A prior sweep believed the per-section preview files
// (`alert-dialog-{basic,small,media,small-media,destructive}.tsx`) had
// migrated to an incompatible combined `bases/radix` harness and fell back to
// `ai-generated` coverage — that was wrong: all six live as plain files
// (compatible with our `alert-dialog.tsx` API) in
// `apps/v4/examples/radix/alert-dialog-*.tsx`, the source the docs' "Radix
// UI" tab renders. Each is transcribed verbatim below, adapting only the
// import path, our `lucide` icons, and (for `Basic`) the a11y name asserted
// in `play`. `alert-dialog-demo.tsx` (the unsectioned hero example at the top
// of the docs page) is near-identical to `alert-dialog-basic.tsx` — same
// composition, marginally shorter description — so it isn't given its own
// story; `Basic` transcribes `alert-dialog-basic.tsx`, whose description text
// matches what this file already rendered. `InDialog` remains `ai-generated`:
// our own composition (nesting an AlertDialog inside an open Dialog) that
// upstream doesn't document. Upstream example we intentionally skip: RTL
// (excluded by convention).
const meta = {
  component: AlertDialog,
  parameters: {
    layout: "centered",
  },
  tags: ["autodocs", "shadcn-example"],
} satisfies Meta<typeof AlertDialog>;

export default meta;

type Story = StoryObj<typeof meta>;

/**
 * Use to interrupt the user with a confirmation before a consequential
 * action; the play function verifies the alertdialog role, description
 * wiring, and focus return on cancel.
 *
 * Verbatim from [shadcn Alert Dialog › Basic](https://ui.shadcn.com/docs/components/radix/alert-dialog#basic).
 *
 * @summary for the standard confirmation dialog
 */
export const Basic: Story = {
  render: () => (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant="outline">Show Dialog</Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
          <AlertDialogDescription>
            This action cannot be undone. This will permanently delete your
            account and remove your data from our servers.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction>Continue</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  ),
  play: async ({ canvas, userEvent }) => {
    const trigger = canvas.getByRole("button", { name: "Show Dialog" });

    await userEvent.click(trigger);
    const dialog = await screen.findByRole("alertdialog", {
      name: "Are you absolutely sure?",
    });
    await expect(dialog).toHaveAccessibleDescription(
      "This action cannot be undone. This will permanently delete your account and remove your data from our servers.",
    );

    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() =>
      expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument(),
    );
    await expect(trigger).toHaveFocus();
  },
};

/**
 * Use `size="sm"` for short, low-stakes confirmations such as device
 * permission prompts.
 *
 * Verbatim from [shadcn Alert Dialog › Small](https://ui.shadcn.com/docs/components/radix/alert-dialog#small).
 *
 * @summary for compact confirmations
 */
export const Small: Story = {
  render: () => (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant="outline">Show Dialog</Button>
      </AlertDialogTrigger>
      <AlertDialogContent size="sm">
        <AlertDialogHeader>
          <AlertDialogTitle>Allow accessory to connect?</AlertDialogTitle>
          <AlertDialogDescription>
            Do you want to allow the USB accessory to connect to this device?
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Don&apos;t allow</AlertDialogCancel>
          <AlertDialogAction>Allow</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  ),
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole("button", { name: "Show Dialog" }));
    const dialog = await screen.findByRole("alertdialog", {
      name: "Allow accessory to connect?",
    });

    await expect(dialog).toHaveAttribute("data-size", "sm");
    await userEvent.click(screen.getByRole("button", { name: "Allow" }));
    await waitFor(() =>
      expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument(),
    );
  },
};

/**
 * Use AlertDialogMedia to lead with an icon that anchors the confirmation's
 * subject.
 *
 * Verbatim from [shadcn Alert Dialog › Media](https://ui.shadcn.com/docs/components/radix/alert-dialog#media).
 *
 * @summary for confirmations with a leading icon
 */
export const Media: Story = {
  render: () => (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant="outline">Share Project</Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogMedia>
            <CircleFadingPlusIcon />
          </AlertDialogMedia>
          <AlertDialogTitle>Share this project?</AlertDialogTitle>
          <AlertDialogDescription>
            Anyone with the link will be able to view and edit this project.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction>Share</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  ),
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(
      canvas.getByRole("button", { name: "Share Project" }),
    );
    const dialog = await screen.findByRole("alertdialog", {
      name: "Share this project?",
    });

    await waitFor(() =>
      expect(
        dialog.querySelector("[data-slot='alert-dialog-media']"),
      ).toBeVisible(),
    );
    await userEvent.click(screen.getByRole("button", { name: "Share" }));
    await waitFor(() =>
      expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument(),
    );
  },
};

/**
 * Use the compact size and media slot together for permission-style prompts
 * with an identifying icon.
 *
 * Verbatim from [shadcn Alert Dialog › Small with Media](https://ui.shadcn.com/docs/components/radix/alert-dialog#small-with-media).
 *
 * @summary for compact icon-led prompts
 */
export const SmallWithMedia: Story = {
  render: () => (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant="outline">Show Dialog</Button>
      </AlertDialogTrigger>

      <AlertDialogContent size="sm">
        <AlertDialogHeader>
          <AlertDialogMedia>
            <BluetoothIcon />
          </AlertDialogMedia>
          <AlertDialogTitle>Allow accessory to connect?</AlertDialogTitle>
          <AlertDialogDescription>
            Do you want to allow the USB accessory to connect to this device?
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Don&apos;t allow</AlertDialogCancel>
          <AlertDialogAction>Allow</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  ),
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole("button", { name: "Show Dialog" }));
    const dialog = await screen.findByRole("alertdialog", {
      name: "Allow accessory to connect?",
    });

    await expect(dialog).toHaveAttribute("data-size", "sm");
    await waitFor(() =>
      expect(
        dialog.querySelector("[data-slot='alert-dialog-media']"),
      ).toBeVisible(),
    );
    await userEvent.click(screen.getByRole("button", { name: "Don't allow" }));
  },
};

/**
 * Use destructive styling on the confirming action when the operation is
 * irreversible deletion; keep Cancel as the safe low-emphasis option.
 *
 * Verbatim from [shadcn Alert Dialog › Destructive](https://ui.shadcn.com/docs/components/radix/alert-dialog#destructive).
 *
 * @summary for irreversible destructive confirmations
 */
export const Destructive: Story = {
  render: () => (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant="destructive">Delete Chat</Button>
      </AlertDialogTrigger>
      <AlertDialogContent size="sm">
        <AlertDialogHeader>
          <AlertDialogMedia className="bg-destructive/10 text-destructive dark:bg-destructive/20 dark:text-destructive">
            <Trash2Icon />
          </AlertDialogMedia>
          <AlertDialogTitle>Delete chat?</AlertDialogTitle>
          <AlertDialogDescription>
            This will permanently delete this chat conversation. View{" "}
            <a href="#">Settings</a> delete any memories saved during this chat.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel variant="outline">Cancel</AlertDialogCancel>
          <AlertDialogAction variant="destructive">Delete</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  ),
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole("button", { name: "Delete Chat" }));
    const dialog = await screen.findByRole("alertdialog", {
      name: "Delete chat?",
    });

    await expect(dialog).toHaveAttribute("data-size", "sm");
    await expect(
      screen.getByRole("button", { name: "Delete" }),
    ).toHaveAttribute("data-variant", "destructive");
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
  },
};

/**
 * Use to confirm an action initiated inside an open Dialog — the alert
 * stacks above it and returns focus to the dialog on dismiss. Our own
 * composition; upstream does not document nesting an AlertDialog inside a
 * Dialog.
 *
 * @summary for stacking above an open Dialog
 */
export const InDialog: Story = {
  tags: ["ai-generated", "!shadcn-example"],
  render: () => (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="outline">Open Dialog</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Alert Dialog Example</DialogTitle>
          <DialogDescription>
            Click the button below to open an alert dialog.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button>Open Alert Dialog</Button>
            </AlertDialogTrigger>
            <AlertDialogContent size="sm">
              <AlertDialogHeader>
                <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
                <AlertDialogDescription>
                  This action cannot be undone. This will permanently delete
                  your account and remove your data from our servers.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction>Continue</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  ),
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole("button", { name: "Open Dialog" }));
    const dialog = await screen.findByRole("dialog", {
      name: "Alert Dialog Example",
    });

    await userEvent.click(
      screen.getByRole("button", { name: "Open Alert Dialog" }),
    );
    const alertDialog = await screen.findByRole("alertdialog", {
      name: "Are you absolutely sure?",
    });
    await expect(alertDialog).toHaveAttribute("data-size", "sm");

    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() =>
      expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument(),
    );
    await expect(dialog).toBeVisible();
  },
};
