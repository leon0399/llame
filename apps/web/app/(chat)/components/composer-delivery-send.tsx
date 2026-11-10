"use client";

import {
  ChevronDownIcon,
  HandIcon,
  ListPlusIcon,
  SendIcon,
} from "lucide-react";

import { ButtonGroup } from "@workspace/ui/components/button-group";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu";
import { Kbd } from "@workspace/ui/components/kbd";
import { usePrimaryModifierKey } from "@workspace/ui/hooks/use-modifier-key";

import { ComposerTooltip } from "./composer-tooltip";
import { PromptInputButton } from "./prompt-input";

/** The delivery modes the menu offers; Steer is the main action. */
export type MenuDeliveryMode = "interrupt" | "queue";

type DeliverySendButtonProps = {
  /** Nothing to send, or sending is blocked. */
  disabled: boolean;
  onDeliver: (mode: MenuDeliveryMode) => void;
};

/** The main action: submits the form, which steers. */
function SteerButton({ disabled }: { disabled: boolean }) {
  return (
    <ComposerTooltip
      label="Steer the Run"
      shortcut="Enter"
      render={
        <PromptInputButton
          variant="ghost"
          size="icon"
          type="submit"
          aria-label="Steer"
          aria-keyshortcuts="Enter"
          disabled={disabled}
        />
      }
    >
      <SendIcon size={16} />
    </ComposerTooltip>
  );
}

/** The menu's Queue row, naming its shortcut the way the `+` menu names ⌘U. */
function QueueItem({ onClick }: { onClick: () => void }) {
  const modifierKey = usePrimaryModifierKey();

  return (
    <DropdownMenuItem
      onClick={onClick}
      aria-keyshortcuts={`${modifierKey === "⌘" ? "Meta" : "Control"}+Enter`}
    >
      <ListPlusIcon />
      <span>Queue</span>
      {/* Announced through `aria-keyshortcuts`, not the item's name. */}
      <Kbd aria-hidden="true" className="ml-auto">
        {`${modifierKey}+Enter`}
      </Kbd>
    </DropdownMenuItem>
  );
}

/** The chevron and its menu: Interrupt and Queue. */
function SendMenu({ disabled, onDeliver }: DeliverySendButtonProps) {
  return (
    <DropdownMenu>
      <ComposerTooltip
        label="More ways to send"
        render={
          <DropdownMenuTrigger
            render={
              <PromptInputButton
                variant="ghost"
                size="icon"
                aria-label="More ways to send"
                disabled={disabled}
              />
            }
          />
        }
      >
        <ChevronDownIcon size={16} />
      </ComposerTooltip>
      <DropdownMenuContent align="end" className="w-max min-w-56">
        <DropdownMenuItem onClick={() => onDeliver("interrupt")}>
          <HandIcon />
          <span>Interrupt</span>
        </DropdownMenuItem>
        <QueueItem onClick={() => onDeliver("queue")} />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * The Send control while a Run is active (run-steering D11): a split button
 * whose main action steers (Enter) and whose menu offers Interrupt and Queue
 * (Mod+Enter). Queue is never the default, so a message the owner wants
 * delivered now is never held until the Run ends.
 *
 * @summary split Send: Steer, with Interrupt and Queue in the menu
 */
export function DeliverySendButton(props: DeliverySendButtonProps) {
  return (
    <ButtonGroup>
      <SteerButton disabled={props.disabled} />
      <SendMenu {...props} />
    </ButtonGroup>
  );
}
