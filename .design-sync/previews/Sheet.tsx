// Owned preview. Basic's `play` leaves the sheet open (storybook's own
// screenshot shows it open) — previews compile the story render only, play
// never runs, so this forces the same open state with `defaultOpen`.
// NoCloseButton/Sides/LongContent all dismiss their sheet by the end of
// `play`, so their storybook reference renders closed too — those stay
// plain, unforced renders.
import * as React from "react";

import { Button } from "@workspace/ui/components/button";
import { Input } from "@workspace/ui/components/input";
import { Label } from "@workspace/ui/components/label";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@workspace/ui/components/sheet";

const loremIpsum =
  "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat. Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur. Excepteur sint occaecat cupidatat non proident, sunt in culpa qui officia deserunt mollit anim id est laborum.";

export const Basic = () => (
  <Sheet defaultOpen>
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
);

export const NoCloseButton = () => (
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
);

const SHEET_SIDES = ["top", "right", "bottom", "left"] as const;

export const Sides = () => (
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
);

export const LongContent = () => (
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
);
