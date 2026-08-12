// Owned preview. Every story here opens its dialog via a `play` function
// (userEvent.click on the trigger) — Basic and InDialog leave it open at rest
// (that's what storybook's own screenshot shows), so this mirrors the
// stories' JSX with `defaultOpen` forcing the same open state a generated
// preview can't reach (previews compile the story render only; play never
// runs). Small/Media/SmallWithMedia/Destructive dismiss their dialog by the
// end of `play`, so their storybook reference renders closed too — those
// stay plain, unforced renders.
import * as React from "react";
import { BluetoothIcon, CircleFadingPlusIcon, Trash2Icon } from "lucide-react";

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
} from "@workspace/ui/components/alert-dialog";
import { Button } from "@workspace/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@workspace/ui/components/dialog";

export const Basic = () => (
  <AlertDialog defaultOpen>
    <AlertDialogTrigger render={<Button variant="outline" />}>
      Show Dialog
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
);

export const Small = () => (
  <AlertDialog>
    <AlertDialogTrigger render={<Button variant="outline" />}>
      Show Dialog
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
);

export const Media = () => (
  <AlertDialog>
    <AlertDialogTrigger render={<Button variant="outline" />}>
      Share Project
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
);

export const SmallWithMedia = () => (
  <AlertDialog>
    <AlertDialogTrigger render={<Button variant="outline" />}>
      Show Dialog
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
);

export const Destructive = () => (
  <AlertDialog>
    <AlertDialogTrigger render={<Button variant="destructive" />}>
      Delete Chat
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
);

// play opens the outer Dialog, then opens and dismisses the nested
// AlertDialog, ending with the Dialog still open and the AlertDialog closed
// — so only the Dialog is forced open here.
export const InDialog = () => (
  <Dialog defaultOpen>
    <DialogTrigger render={<Button variant="outline" />}>
      Open Dialog
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
          <AlertDialogTrigger render={<Button />}>
            Open Alert Dialog
          </AlertDialogTrigger>
          <AlertDialogContent size="sm">
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
      </DialogFooter>
    </DialogContent>
  </Dialog>
);
