"use client";

import type { ComponentProps, HTMLAttributes } from "react";

import type { LucideProps } from "lucide-react";
import { BookmarkIcon } from "lucide-react";

import { Button } from "@workspace/ui/components/button";
import { Separator } from "@workspace/ui/components/separator";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@workspace/ui/components/tooltip";
import { cn } from "@workspace/ui/lib/utils";

/**
 * Vendored from AI Elements' Checkpoint component
 * (https://elements.ai-sdk.dev/components/checkpoint) — no shadcn-registry
 * entry exists for it (it ships via its own `ai-elements` CLI, not a
 * shadcn-compatible registry URL), so it's hand-adapted here to
 * `@workspace/ui` primitives/import paths, matching how this codebase
 * already vendors other AI Elements pieces (chat-container.tsx,
 * prompt-input.tsx, message/). A horizontal-rule row with an icon + trigger,
 * marking a distinct point in the conversation timeline.
 */
export type CheckpointProps = HTMLAttributes<HTMLDivElement>;

export const Checkpoint = ({
  className,
  children,
  ...props
}: CheckpointProps) => (
  <div
    className={cn(
      "flex items-center gap-0.5 overflow-hidden text-muted-foreground",
      className,
    )}
    {...props}
  >
    {children}
    <Separator />
  </div>
);

export type CheckpointIconProps = LucideProps;

export const CheckpointIcon = ({
  className,
  children,
  ...props
}: CheckpointIconProps) =>
  children ?? (
    <BookmarkIcon className={cn("size-4 shrink-0", className)} {...props} />
  );

export type CheckpointTriggerProps = ComponentProps<typeof Button> & {
  tooltip?: string;
};

export const CheckpointTrigger = ({
  children,
  variant = "ghost",
  size = "sm",
  tooltip,
  ...props
}: CheckpointTriggerProps) =>
  tooltip ? (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button size={size} type="button" variant={variant} {...props}>
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent align="start" side="bottom">
        {tooltip}
      </TooltipContent>
    </Tooltip>
  ) : (
    <Button size={size} type="button" variant={variant} {...props}>
      {children}
    </Button>
  );
