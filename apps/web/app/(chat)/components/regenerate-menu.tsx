"use client";

import { useState } from "react";
import { ChevronDownIcon, RefreshCwIcon } from "lucide-react";

import { Button } from "@workspace/ui/components/button";
import { ButtonGroup } from "@workspace/ui/components/button-group";
import { Field, FieldTitle } from "@workspace/ui/components/field";
import {
  Popover,
  PopoverContent,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "@workspace/ui/components/popover";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@workspace/ui/components/tooltip";

import { useChatContext, type ChatContextType } from "@/contexts/chat-context";
import type { FollowUpRunRequest } from "@/lib/services/chat/transport";

import { EffortSelector } from "./effort-selector";
import { ModelSelector } from "./model-selector";
import { PermissionModeSelector } from "./permission-mode-selector";

type RegenerateMenuProps = {
  chatId: string;
  requestFollowUp: (request: FollowUpRunRequest) => void;
};

/** The follow-up request the composer's own selections produce. */
function composerRegenerateRequest(
  composer: Pick<
    ChatContextType,
    "selectedModel" | "selectedEffort" | "getPermissionMode"
  >,
  chatId: string,
): FollowUpRunRequest | null {
  const { selectedModel, selectedEffort, getPermissionMode } = composer;
  // Regenerate always names a model; until the catalog resolved one there is
  // nothing to submit.
  if (selectedModel === undefined) return null;
  return {
    action: "regenerate",
    modelId: selectedModel,
    effort: selectedEffort,
    permissionMode: getPermissionMode(chatId),
  };
}

/**
 * The Regenerate split button's menu: the composer's own model, effort, and
 * permission-mode selectors, so a pick sets the composer, plus the submit that
 * regenerates with those values (turn-actions D13). Selecting a value writes it
 * to the composer through the selectors themselves — nothing is duplicated
 * here.
 *
 * @summary composer selectors plus a submit for a Regenerate
 */
export function RegenerateMenu({
  chatId,
  requestFollowUp,
}: RegenerateMenuProps) {
  const [open, setOpen] = useState(false);
  const composer = useChatContext();
  const request = composerRegenerateRequest(composer, chatId);

  return (
    <Popover open={open} onOpenChange={setOpen} modal={false}>
      <RegenerateMenuTrigger />
      <RegenerateMenuContent
        chatId={chatId}
        request={request}
        onSubmit={(submitted) => {
          setOpen(false);
          requestFollowUp(submitted);
        }}
      />
    </Popover>
  );
}

/** The split button's tail: a chevron that opens the menu, named by its
 *  tooltip like the row's icon actions. The tooltip wraps the popover
 *  trigger: the reverse nesting re-renders the tooltip's trigger on hover and
 *  closes the tooltip at once. */
function RegenerateMenuTrigger() {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <PopoverTrigger
            render={
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label="Regenerate with other settings"
              />
            }
          />
        }
      >
        <ChevronDownIcon aria-hidden="true" />
      </TooltipTrigger>
      <TooltipContent>Regenerate with other settings</TooltipContent>
    </Tooltip>
  );
}

/** The composer's selectors as labelled rows: the model joined with its
 *  effort, as in the composer, then the permission mode. */
function RegenerateSettings({ chatId }: { chatId: string }) {
  return (
    <div className="flex flex-col gap-1">
      <Field orientation="horizontal">
        <FieldTitle>Model</FieldTitle>
        {/* The effort cell only renders for a model that declares an effort
            vocabulary. */}
        <ButtonGroup>
          <ModelSelector />
          <EffortSelector />
        </ButtonGroup>
      </Field>
      <Field orientation="horizontal">
        <FieldTitle>Permissions</FieldTitle>
        <PermissionModeSelector chatId={chatId} />
      </Field>
    </div>
  );
}

type RegenerateMenuContentProps = {
  chatId: string;
  request: FollowUpRunRequest | null;
  onSubmit: (request: FollowUpRunRequest) => void;
};

/** The menu body: a title, the composer's settings, then the submit that
 *  regenerates with them. */
function RegenerateMenuContent({
  chatId,
  request,
  onSubmit,
}: RegenerateMenuContentProps) {
  return (
    // Base UI names the role=dialog popup from its `PopoverTitle`.
    <PopoverContent side="top" align="start" className="w-auto min-w-72">
      <PopoverHeader>
        <PopoverTitle>Regenerate with</PopoverTitle>
      </PopoverHeader>
      <RegenerateSettings chatId={chatId} />
      <Button
        type="button"
        size="sm"
        className="self-end"
        disabled={request === null}
        onClick={() => {
          if (request !== null) onSubmit(request);
        }}
      >
        <RefreshCwIcon data-icon="inline-start" aria-hidden="true" />
        Regenerate
      </Button>
    </PopoverContent>
  );
}
