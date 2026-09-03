// Owned preview — all 8 stories (compare.mjs's [STORY_CAP] caps grading at
// 6, not shipping: OnLink/FormattedContent are captured in the bundle even
// though they aren't graded).
//
// Basic/Sides hover then unhover in `play`, so storybook's own screenshot
// shows them closed — those stay plain, unforced renders. WithIcon,
// LongContent, Disabled, WithKeyboardShortcut, OnLink, and FormattedContent
// all hover and never unhover, so storybook renders them open; this forces
// the same state with `defaultOpen` (previews compile the story render
// only, play never runs).
import * as React from "react";
import { InfoIcon, SaveIcon } from "lucide-react";

import { Button } from "@workspace/ui/components/button";
import { Kbd } from "@workspace/ui/components/kbd";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@workspace/ui/components/tooltip";

export const Basic = () => (
  <TooltipProvider>
    <Tooltip>
      <TooltipTrigger render={<Button variant="outline" />}>
        Hover
      </TooltipTrigger>
      <TooltipContent>
        <p>Add to library</p>
      </TooltipContent>
    </Tooltip>
  </TooltipProvider>
);

export const Sides = () => (
  <TooltipProvider>
    <div className="flex flex-wrap gap-2">
      {(["left", "top", "bottom", "right"] as const).map((side) => (
        <Tooltip key={side}>
          <TooltipTrigger
            render={<Button variant="outline" className="w-fit capitalize" />}
          >
            {side}
          </TooltipTrigger>
          <TooltipContent side={side}>
            <p>Add to library</p>
          </TooltipContent>
        </Tooltip>
      ))}
    </div>
  </TooltipProvider>
);

export const WithIcon = () => (
  <TooltipProvider>
    <Tooltip defaultOpen>
      <TooltipTrigger render={<Button variant="ghost" size="icon" />}>
        <InfoIcon />
        <span className="sr-only">Info</span>
      </TooltipTrigger>
      <TooltipContent>
        <p>Additional information</p>
      </TooltipContent>
    </Tooltip>
  </TooltipProvider>
);

export const LongContent = () => (
  <TooltipProvider>
    <Tooltip defaultOpen>
      <TooltipTrigger render={<Button variant="outline" className="w-fit" />}>
        Show Tooltip
      </TooltipTrigger>
      <TooltipContent>
        To learn more about how this works, check out the docs. If you have any
        questions, please reach out to us.
      </TooltipContent>
    </Tooltip>
  </TooltipProvider>
);

export const Disabled = () => (
  <TooltipProvider>
    <Tooltip defaultOpen>
      <TooltipTrigger render={<span className="inline-block w-fit" />}>
        <Button variant="outline" disabled>
          Disabled
        </Button>
      </TooltipTrigger>
      <TooltipContent>
        <p>This feature is currently unavailable</p>
      </TooltipContent>
    </Tooltip>
  </TooltipProvider>
);

export const WithKeyboardShortcut = () => (
  <TooltipProvider>
    <Tooltip defaultOpen>
      <TooltipTrigger
        render={
          <Button variant="outline" size="icon-sm" aria-label="Save changes" />
        }
      >
        <SaveIcon />
      </TooltipTrigger>
      <TooltipContent>
        Save Changes <Kbd>S</Kbd>
      </TooltipContent>
    </Tooltip>
  </TooltipProvider>
);

export const OnLink = () => (
  <TooltipProvider>
    <Tooltip defaultOpen>
      <TooltipTrigger
        render={
          <a
            href="#"
            className="w-fit text-sm text-primary underline-offset-4 hover:underline"
            onClick={(event) => event.preventDefault()}
          />
        }
      >
        Learn more
      </TooltipTrigger>
      <TooltipContent>
        <p>Click to read the documentation</p>
      </TooltipContent>
    </Tooltip>
  </TooltipProvider>
);

export const FormattedContent = () => (
  <TooltipProvider>
    <Tooltip defaultOpen>
      <TooltipTrigger render={<Button variant="outline" className="w-fit" />}>
        Status
      </TooltipTrigger>
      <TooltipContent>
        <div className="flex flex-col gap-1">
          <p className="font-semibold">Active</p>
          <p className="text-xs opacity-80">Last updated 2 hours ago</p>
        </div>
      </TooltipContent>
    </Tooltip>
  </TooltipProvider>
);
