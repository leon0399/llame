// Owned preview. Every story except InDialog dismisses its popover by the
// end of `play`, so their storybook reference renders closed too — those
// stay plain, unforced renders. InDialog's `play` opens the outer Dialog
// and then the nested Popover and never closes either, so storybook's own
// screenshot shows both open; this forces the same state with `defaultOpen`
// on both (previews compile the story render only, play never runs).
import * as React from "react";

import { Button } from "@workspace/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@workspace/ui/components/dialog";
import { Field, FieldGroup, FieldLabel } from "@workspace/ui/components/field";
import { Input } from "@workspace/ui/components/input";
import { Label } from "@workspace/ui/components/label";
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "@workspace/ui/components/popover";

export const Basic = () => (
  <Popover>
    <PopoverTrigger render={<Button variant="outline" />}>
      Open popover
    </PopoverTrigger>
    <PopoverContent className="w-80">
      <div className="grid gap-4">
        <div className="space-y-2">
          <h4 className="leading-none font-medium">Dimensions</h4>
          <p className="text-sm text-muted-foreground">
            Set the dimensions for the layer.
          </p>
        </div>
        <div className="grid gap-2">
          <div className="grid grid-cols-3 items-center gap-4">
            <Label htmlFor="width">Width</Label>
            <Input id="width" defaultValue="100%" className="col-span-2 h-8" />
          </div>
          <div className="grid grid-cols-3 items-center gap-4">
            <Label htmlFor="maxWidth">Max. width</Label>
            <Input
              id="maxWidth"
              defaultValue="300px"
              className="col-span-2 h-8"
            />
          </div>
          <div className="grid grid-cols-3 items-center gap-4">
            <Label htmlFor="height">Height</Label>
            <Input id="height" defaultValue="25px" className="col-span-2 h-8" />
          </div>
          <div className="grid grid-cols-3 items-center gap-4">
            <Label htmlFor="maxHeight">Max. height</Label>
            <Input
              id="maxHeight"
              defaultValue="none"
              className="col-span-2 h-8"
            />
          </div>
        </div>
      </div>
    </PopoverContent>
  </Popover>
);

export const WithHeader = () => (
  <Popover>
    <PopoverTrigger render={<Button variant="outline" />}>
      Open Popover
    </PopoverTrigger>
    <PopoverContent align="start">
      <PopoverHeader>
        <PopoverTitle>Dimensions</PopoverTitle>
        <PopoverDescription>
          Set the dimensions for the layer.
        </PopoverDescription>
      </PopoverHeader>
    </PopoverContent>
  </Popover>
);

export const Alignments = () => (
  <div className="flex gap-6">
    <Popover>
      <PopoverTrigger render={<Button variant="outline" size="sm" />}>
        Start
      </PopoverTrigger>
      <PopoverContent align="start" className="w-40">
        Aligned to start
      </PopoverContent>
    </Popover>
    <Popover>
      <PopoverTrigger render={<Button variant="outline" size="sm" />}>
        Center
      </PopoverTrigger>
      <PopoverContent align="center" className="w-40">
        Aligned to center
      </PopoverContent>
    </Popover>
    <Popover>
      <PopoverTrigger render={<Button variant="outline" size="sm" />}>
        End
      </PopoverTrigger>
      <PopoverContent align="end" className="w-40">
        Aligned to end
      </PopoverContent>
    </Popover>
  </div>
);

export const WithForm = () => (
  <Popover>
    <PopoverTrigger render={<Button variant="outline" />}>
      Open Popover
    </PopoverTrigger>
    <PopoverContent className="w-64" align="start">
      <PopoverHeader>
        <PopoverTitle>Dimensions</PopoverTitle>
        <PopoverDescription>
          Set the dimensions for the layer.
        </PopoverDescription>
      </PopoverHeader>
      <FieldGroup className="gap-4">
        <Field orientation="horizontal">
          <FieldLabel htmlFor="width" className="w-1/2">
            Width
          </FieldLabel>
          <Input id="width" defaultValue="100%" />
        </Field>
        <Field orientation="horizontal">
          <FieldLabel htmlFor="height" className="w-1/2">
            Height
          </FieldLabel>
          <Input id="height" defaultValue="25px" />
        </Field>
      </FieldGroup>
    </PopoverContent>
  </Popover>
);

export const InDialog = () => (
  <Dialog defaultOpen>
    <DialogTrigger render={<Button variant="outline" />}>
      Open Dialog
    </DialogTrigger>
    <DialogContent>
      <DialogHeader>
        <DialogTitle>Popover Example</DialogTitle>
        <DialogDescription>
          Click the button below to see the popover.
        </DialogDescription>
      </DialogHeader>
      <Popover defaultOpen>
        <PopoverTrigger render={<Button variant="outline" className="w-fit" />}>
          Open Popover
        </PopoverTrigger>
        <PopoverContent aria-label="Popover in Dialog" align="start">
          <PopoverHeader>
            <PopoverTitle>Popover in Dialog</PopoverTitle>
            <PopoverDescription>
              This popover appears inside a dialog. Click the button to open it.
            </PopoverDescription>
          </PopoverHeader>
        </PopoverContent>
      </Popover>
    </DialogContent>
  </Dialog>
);
