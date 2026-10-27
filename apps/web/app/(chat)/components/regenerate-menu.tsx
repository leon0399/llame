"use client";

import { useState } from "react";
import { ChevronDownIcon } from "lucide-react";

import { Button } from "@workspace/ui/components/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@workspace/ui/components/popover";

import { useChatContext, type ChatContextType } from "@/contexts/chat-context";
import type { FollowUpRunRequest } from "@/lib/services/chat/transport";

import { EffortSelector } from "./effort-selector";
import { ModelSelector } from "./model-selector";
import { PermissionModeSelector } from "./permission-mode-selector";

type RegenerateMenuProps = {
  chatId: string;
  requestRegenerate: (request: FollowUpRunRequest) => void;
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
  const permissionMode = getPermissionMode(chatId);
  return {
    action: "regenerate",
    modelId: selectedModel,
    ...(selectedEffort !== undefined && { effort: selectedEffort }),
    ...(permissionMode === "bypass" && { permissionMode }),
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
  requestRegenerate,
}: RegenerateMenuProps) {
  const [open, setOpen] = useState(false);
  const composer = useChatContext();
  const request = composerRegenerateRequest(composer, chatId);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="xs"
            aria-label="Regenerate with other settings"
            aria-expanded={open}
          />
        }
      >
        <ChevronDownIcon data-icon="inline-start" aria-hidden="true" />
      </PopoverTrigger>
      <RegenerateMenuContent
        chatId={chatId}
        request={request}
        onSubmit={(submitted) => {
          setOpen(false);
          requestRegenerate(submitted);
        }}
      />
    </Popover>
  );
}

type RegenerateMenuContentProps = {
  chatId: string;
  request: FollowUpRunRequest | null;
  onSubmit: (request: FollowUpRunRequest) => void;
};

/** The menu body: the composer's selectors, then the submit that regenerates
 *  with them. Split out of `RegenerateMenu` to keep both within the line
 *  budget. */
function RegenerateMenuContent({
  chatId,
  request,
  onSubmit,
}: RegenerateMenuContentProps) {
  return (
    <PopoverContent
      // Base UI renders the popover with role=dialog, which needs its own
      // accessible name — the trigger's label does not carry over.
      aria-label="Regenerate settings"
      side="top"
      align="end"
      className="w-80"
    >
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-1">
          <ModelSelector />
          <EffortSelector />
          <PermissionModeSelector chatId={chatId} />
        </div>
        <Button
          type="button"
          size="sm"
          disabled={request === null}
          onClick={() => {
            if (request !== null) onSubmit(request);
          }}
        >
          Regenerate with these settings
        </Button>
      </div>
    </PopoverContent>
  );
}
