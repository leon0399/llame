// Owned preview. Basic/CustomCloseButton/NoCloseButton all dismiss the
// dialog by the end of `play` (Cancel click / footer Close click / Escape),
// so storybook's own screenshot shows them closed too — those stay plain,
// unforced renders. StickyFooter and ScrollableContent never close in
// `play`, so storybook renders them open (a centered overlay, so it overlaps
// #storybook-root's reference bbox — see learnings/overlays.md finding #1);
// this forces the same state with `defaultOpen` (previews compile the story
// render only, play never runs).
import * as React from "react";

import { Button } from "@workspace/ui/components/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@workspace/ui/components/dialog";
import { Field, FieldGroup } from "@workspace/ui/components/field";
import { Input } from "@workspace/ui/components/input";
import { Label } from "@workspace/ui/components/label";

const loremIpsum =
  "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat. Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur. Excepteur sint occaecat cupidatat non proident, sunt in culpa qui officia deserunt mollit anim id est laborum.";

export const Basic = () => (
  <Dialog>
    <form>
      <DialogTrigger render={<Button variant="outline" />}>
        Open Dialog
      </DialogTrigger>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Edit profile</DialogTitle>
          <DialogDescription>
            Make changes to your profile here. Click save when you&apos;re done.
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
          <DialogClose render={<Button variant="outline" />}>
            Cancel
          </DialogClose>
          <Button type="submit">Save changes</Button>
        </DialogFooter>
      </DialogContent>
    </form>
  </Dialog>
);

export const CustomCloseButton = () => (
  <Dialog>
    <DialogTrigger render={<Button variant="outline" />}>Share</DialogTrigger>
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
        <DialogClose render={<Button type="button" />}>Close</DialogClose>
      </DialogFooter>
    </DialogContent>
  </Dialog>
);

export const NoCloseButton = () => (
  <Dialog>
    <DialogTrigger render={<Button variant="outline" />}>
      No Close Button
    </DialogTrigger>
    <DialogContent showCloseButton={false}>
      <DialogHeader>
        <DialogTitle>No Close Button</DialogTitle>
        <DialogDescription>
          This dialog doesn&apos;t have a close button in the top-right corner.
        </DialogDescription>
      </DialogHeader>
    </DialogContent>
  </Dialog>
);

export const StickyFooter = () => (
  <Dialog defaultOpen>
    <DialogTrigger render={<Button variant="outline" />}>
      Sticky Footer
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
        <DialogClose render={<Button variant="outline" />}>Close</DialogClose>
      </DialogFooter>
    </DialogContent>
  </Dialog>
);

export const ScrollableContent = () => (
  <Dialog defaultOpen>
    <DialogTrigger render={<Button variant="outline" />}>
      Scrollable Content
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
);
