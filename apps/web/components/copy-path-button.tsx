"use client";

import { useState, type ReactElement } from "react";
import { CheckIcon, CopyIcon } from "lucide-react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu";
import { toast } from "@workspace/ui/components/sonner";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@workspace/ui/components/tooltip";

import { copyText } from "@/lib/clipboard";
import {
  machineNameFromRoot,
  machinePathFromRoot,
} from "@/lib/services/machines/locator";

/** How long the check replaces the copy icon, as on a message's Copy. */
const COPIED_FOR_MS = 1500;

/** A copy that confirms itself in place: the icon turns into a check for a
 *  moment. Only a failure reaches a toast, since it needs words. */
function useCopy() {
  const [copied, setCopied] = useState(false);
  const copy = async (text: string, what: string) => {
    if (await copyText(text)) {
      setCopied(true);
      setTimeout(() => setCopied(false), COPIED_FOR_MS);
    } else {
      toast.error(`Couldn't copy the ${what}.`);
    }
  };
  return { copied, copy };
}

function CopyGlyph({ copied }: { copied: boolean }) {
  return copied ? (
    <CheckIcon aria-hidden="true" />
  ) : (
    <CopyIcon aria-hidden="true" />
  );
}

type CopyState = ReturnType<typeof useCopy>;

/** The trigger's face and its tooltip; the tooltip names the action, never
 *  the path the row beside it already shows. A menu trigger renders outermost
 *  so the element keeps its `dropdown-menu-trigger` slot, which is what keeps
 *  a hover-revealed row's actions showing while the menu is open. */
function CopyTrigger({
  label,
  copied,
  trigger,
  menu = false,
  onClick,
}: {
  label: string;
  copied: boolean;
  trigger: ReactElement;
  menu?: boolean;
  onClick?: () => void;
}) {
  // Marks the trigger while its check shows, so a hover-revealed row can keep
  // the check in sight after the pointer leaves.
  const marker = { "data-copied": copied ? "" : undefined };
  const face = (
    <>
      <CopyGlyph copied={copied} />
      <span className="sr-only">{label}</span>
    </>
  );
  return (
    <Tooltip>
      {menu ? (
        <DropdownMenuTrigger
          render={<TooltipTrigger render={trigger} />}
          {...marker}
        >
          {face}
        </DropdownMenuTrigger>
      ) : (
        <TooltipTrigger render={trigger} onClick={onClick} {...marker}>
          {face}
        </TooltipTrigger>
      )}
      <TooltipContent>{copied ? "Copied" : label}</TooltipContent>
    </Tooltip>
  );
}

function MachineCopyMenu({
  location,
  machinePath,
  trigger,
  state,
}: {
  location: string;
  machinePath: string;
  trigger: ReactElement;
  state: CopyState;
}) {
  return (
    <DropdownMenu>
      <CopyTrigger
        label="Copy path or locator"
        copied={state.copied}
        trigger={trigger}
        menu
      />
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={() => void state.copy(machinePath, "path")}>
          Path on {machineNameFromRoot(location)}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => void state.copy(location, "locator")}>
          Locator
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * The copy control for a filesystem location, beside the text that already
 * shows it — so neither its tooltip nor its name repeats the path. A host
 * path copies at once. A `machine://` locator opens a two-item menu: the path
 * a terminal on that Machine takes, or the locator the tools take.
 *
 * `trigger` is the button element to render the control as (a ghost icon
 * button in a list, a `SidebarMenuAction` in the sidebar); it receives the
 * icon as its children.
 *
 * @summary copy a host path, or a Machine path or locator, with an in-place check
 */
export function CopyPathButton({
  location,
  trigger,
}: {
  /** A host path, or a `machine://<name>/…` locator. */
  location: string;
  trigger: ReactElement;
}) {
  const state = useCopy();
  const machinePath = machinePathFromRoot(location);
  return (
    <>
      {machinePath === undefined ? (
        <CopyTrigger
          label="Copy path"
          copied={state.copied}
          trigger={trigger}
          onClick={() => void state.copy(location, "path")}
        />
      ) : (
        <MachineCopyMenu
          location={location}
          machinePath={machinePath}
          trigger={trigger}
          state={state}
        />
      )}
      {/* Outside the button, so its name stays the same; announces success. */}
      <output className="sr-only">{state.copied ? "Copied" : ""}</output>
    </>
  );
}
