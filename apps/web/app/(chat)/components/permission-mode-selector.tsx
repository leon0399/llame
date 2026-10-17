"use client";

import * as React from "react";

import { Button } from "@workspace/ui/components/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu";

import { type PermissionMode, useChatContext } from "@/contexts/chat-context";
import {
  usePermissionModesQuery,
  type PermissionModesResponse,
} from "@/lib/services/permission-modes/queries";

import { ComposerTooltip } from "./composer-tooltip";

type PermissionModeDetails = {
  title: string;
  description: string;
};

const PERMISSION_MODE_DETAILS: Record<PermissionMode, PermissionModeDetails> = {
  default: {
    title: "Default",
    description: "Applies the operator tool policy.",
  },
  bypass: {
    title: "Bypass",
    description: "Skips tool-permission checks for this chat.",
  },
};

function isPermissionMode(value: string): value is PermissionMode {
  return value === "default" || value === "bypass";
}

function PermissionModeItem({ mode }: { mode: PermissionMode }) {
  const details = PERMISSION_MODE_DETAILS[mode];

  return (
    <DropdownMenuRadioItem value={mode} className="items-start">
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="font-medium">{details.title}</span>
        <span className="text-muted-foreground text-xs whitespace-nowrap">
          {details.description}
        </span>
      </span>
    </DropdownMenuRadioItem>
  );
}

export type PermissionModeSelectorProps = {
  chatId: string;
};

function PermissionModeTrigger({
  open,
  selectedMode,
  title,
}: {
  open: boolean;
  selectedMode: PermissionMode;
  title: string;
}) {
  return (
    <ComposerTooltip
      label="Permissions"
      render={
        <DropdownMenuTrigger
          render={
            <Button
              type="button"
              // Bypass keeps the destructive tint: it is the one mode that
              // skips tool-permission checks, so it must not read as a quiet
              // label.
              variant={selectedMode === "bypass" ? "destructive" : "ghost"}
              size="xs"
              aria-label={`Permission mode, ${title}`}
              aria-expanded={open}
            />
          }
        />
      }
    >
      {/* Regular weight: a quiet setting under the input, not an action. */}
      <span className="font-normal">{title}</span>
    </ComposerTooltip>
  );
}

/**
 * Resets a chat's stored selection to `default` when the operator withdraws
 * the selected mode from the listing, so the transport stops sending a mode
 * the composer can no longer show.
 */
function useReconcileWithdrawnMode(
  chatId: string,
  modes: PermissionModesResponse["modes"] | undefined,
) {
  const { getPermissionMode, setPermissionMode } = useChatContext();
  const selectedMode = getPermissionMode(chatId);
  React.useEffect(() => {
    if (modes === undefined || selectedMode === "default") return;
    if (!modes.some(({ value }) => value === selectedMode)) {
      setPermissionMode(chatId, "default");
    }
  }, [chatId, modes, selectedMode, setPermissionMode]);
}

/**
 * Per-chat tool permission mode. The operator controls which modes appear in
 * the listing; with only the safe default enabled, the composer has no control
 * to show.
 */
export function PermissionModeSelector({
  chatId,
}: PermissionModeSelectorProps) {
  const [open, setOpen] = React.useState(false);
  const { getPermissionMode, setPermissionMode } = useChatContext();
  const modesQuery = usePermissionModesQuery();
  const modes = modesQuery.data?.modes;
  const selectedMode = getPermissionMode(chatId);

  useReconcileWithdrawnMode(chatId, modes);

  if (modes === undefined || modes.length < 2) return null;

  const selectedDetails = PERMISSION_MODE_DETAILS[selectedMode];

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <PermissionModeTrigger
        open={open}
        selectedMode={selectedMode}
        title={selectedDetails.title}
      />
      <DropdownMenuContent
        side="top"
        align="start"
        className="w-72"
        aria-label="Permission mode"
      >
        <DropdownMenuRadioGroup
          value={selectedMode}
          onValueChange={(value) => {
            if (isPermissionMode(value)) setPermissionMode(chatId, value);
          }}
        >
          {modes.map(({ value }) => {
            if (!isPermissionMode(value)) return null;
            return <PermissionModeItem key={value} mode={value} />;
          })}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
