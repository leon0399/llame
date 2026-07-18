import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { BluetoothIcon, Trash2Icon } from "lucide-react";
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

// This file is mixed provenance: `shadcn-example` (the meta default below)
// for `Basic`, transcribed from the shadcn Alert Dialog docs
// (https://ui.shadcn.com/docs/components/radix/alert-dialog). `ai-generated`
// stories (each overrides the tag itself) cover states the live docs also
// describe but whose example source has migrated away — see below — plus
// `InDialog`, a composition upstream doesn't document at all.
//
// Upstream is mid-migration to a `radix-nova`/`bases/radix` (Base UI)
// registry, but for this component that migration changed only the *docs
// example organization*, not the component: `alert-dialog.tsx` in
// `bases/radix` is API-identical to `new-york-v4` (same `size` prop, same
// `AlertDialogMedia`) — just different import paths. What did change is that
// the docs page's per-section preview files
// (`alert-dialog-{basic,small,media,small-media,destructive,rtl}.tsx`) were
// removed from `new-york-v4/examples/` with no replacement there; their
// content now lives only inside a combined `bases/radix/examples/alert-dialog-example.tsx`
// that composes an `Example`/`ExampleWrapper` harness plus an
// `IconPlaceholder` we don't vendor — an incompatible source we do not
// transcribe from. We keep our own coverage of those states as
// `ai-generated`: `Small` (Small), `Media` (Media), `SmallWithMedia` (Small
// with Media), `Destructive` (Destructive). `alert-dialog-rtl` is also
// missing, and would be skipped regardless (RTL, excluded by convention).
// Only `alert-dialog-demo.tsx` — the unsectioned hero example at the top of
// the docs page, before any of the above sections — still exists as a plain
// `new-york-v4` file; its content is verbatim what `Basic` renders below.
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
 * Verbatim from [shadcn Alert Dialog](https://ui.shadcn.com/docs/components/radix/alert-dialog)
 * (the unsectioned demo at the top of the page).
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
 * permission prompts. Upstream documents this as the docs page's "Small"
 * section, but that section's example file has migrated to the incompatible
 * `bases/radix` registry (see the file-level note) — we keep our own
 * coverage of the state.
 *
 * @summary for compact confirmations
 */
export const Small: Story = {
  tags: ["ai-generated", "!shadcn-example"],
  render: () => (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant="outline">Small</Button>
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
    await userEvent.click(canvas.getByRole("button", { name: "Small" }));
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
 * subject. Upstream documents this as the docs page's "Media" section, but
 * that section's example file has migrated to the incompatible `bases/radix`
 * registry (see the file-level note) — we keep our own coverage of the
 * state.
 *
 * @summary for confirmations with a leading icon
 */
export const Media: Story = {
  tags: ["ai-generated", "!shadcn-example"],
  render: () => (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant="outline">Default (Media)</Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogMedia>
            <BluetoothIcon />
          </AlertDialogMedia>
          <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
          <AlertDialogDescription>
            This will permanently delete your account and remove your data from
            our servers.
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
    await userEvent.click(
      canvas.getByRole("button", { name: "Default (Media)" }),
    );
    const dialog = await screen.findByRole("alertdialog", {
      name: "Are you absolutely sure?",
    });

    await waitFor(() =>
      expect(
        dialog.querySelector("[data-slot='alert-dialog-media']"),
      ).toBeVisible(),
    );
    await userEvent.click(screen.getByRole("button", { name: "Continue" }));
  },
};

/**
 * Use the compact size and media slot together for permission-style prompts
 * with an identifying icon. Upstream documents this as the docs page's
 * "Small with Media" section, but that section's example file has migrated
 * to the incompatible `bases/radix` registry (see the file-level note) — we
 * keep our own coverage of the state.
 *
 * @summary for compact icon-led prompts
 */
export const SmallWithMedia: Story = {
  tags: ["ai-generated", "!shadcn-example"],
  render: () => (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant="outline">Small (Media)</Button>
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
    await userEvent.click(
      canvas.getByRole("button", { name: "Small (Media)" }),
    );
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
 * Upstream documents this as the docs page's "Destructive" section, but that
 * section's example file has migrated to the incompatible `bases/radix`
 * registry (see the file-level note) — we keep our own coverage of the
 * state.
 *
 * @summary for irreversible destructive confirmations
 */
export const Destructive: Story = {
  tags: ["ai-generated", "!shadcn-example"],
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
          <AlertDialogCancel variant="ghost">Cancel</AlertDialogCancel>
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
