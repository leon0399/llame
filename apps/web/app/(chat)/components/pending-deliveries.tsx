"use client";

import {
  CornerDownRightIcon,
  HandIcon,
  PencilIcon,
  Trash2Icon,
} from "lucide-react";

import { IconButtonTooltip } from "@/components/icon-button-tooltip";
import type { ChatDeliveryResponse } from "@/lib/api/generated/models";
import { deliveryFiles, deliveryText } from "@/lib/services/chat/deliveries";

const MODE_LABEL = {
  steer: "Steer",
  interrupt: "Interrupt",
  queue: "Queued",
} as const;

export type PendingDeliveriesProps = {
  /** The pending items, first to deliver first. */
  items: ReadonlyArray<ChatDeliveryResponse>;
  /** The Chat has no live Run, so nothing delivers until the owner acts. */
  paused: boolean;
  onSteerNow: (item: ChatDeliveryResponse) => void;
  onInterruptNow: (item: ChatDeliveryResponse) => void;
  onDelete: (item: ChatDeliveryResponse) => void;
  onEdit: (item: ChatDeliveryResponse) => void;
};

/** What a row shows of the item: its text, or its attachment count for a
 *  message with no text. */
function previewText(item: ChatDeliveryResponse): string {
  const text = deliveryText(item);
  if (text !== "") return text;
  const files = deliveryFiles(item).length;
  return files === 1 ? "1 attachment" : `${files} attachments`;
}

type RowActionsProps = { item: ChatDeliveryResponse } & Omit<
  PendingDeliveriesProps,
  "items" | "paused"
>;

/** The two ways to hurry an item: absent where the item's mode already has
 *  them. */
function HurryActions({
  item,
  onSteerNow,
  onInterruptNow,
}: Pick<RowActionsProps, "item" | "onSteerNow" | "onInterruptNow">) {
  return (
    <>
      {item.mode === "queue" && (
        <IconButtonTooltip
          label="Steer now"
          size="icon-sm"
          onClick={() => onSteerNow(item)}
        >
          <CornerDownRightIcon />
        </IconButtonTooltip>
      )}
      {item.mode !== "interrupt" && (
        <IconButtonTooltip
          label="Interrupt now"
          size="icon-sm"
          onClick={() => onInterruptNow(item)}
        >
          <HandIcon />
        </IconButtonTooltip>
      )}
    </>
  );
}

/** The actions a row can take: an absent action is one the item's mode cannot
 *  use. */
function RowActions({ onDelete, onEdit, ...hurry }: RowActionsProps) {
  const { item } = hurry;
  return (
    <div className="flex shrink-0 items-center">
      <HurryActions {...hurry} />
      <IconButtonTooltip
        label="Edit"
        size="icon-sm"
        onClick={() => onEdit(item)}
      >
        <PencilIcon />
      </IconButtonTooltip>
      <IconButtonTooltip
        label="Delete"
        size="icon-sm"
        onClick={() => onDelete(item)}
      >
        <Trash2Icon />
      </IconButtonTooltip>
    </div>
  );
}

function PendingRow(props: RowActionsProps) {
  return (
    <li className="flex items-center gap-2 rounded-md border bg-background py-1 pr-1 pl-2.5">
      <span className="shrink-0 text-xs text-muted-foreground">
        {MODE_LABEL[props.item.mode]}
      </span>
      <span className="line-clamp-2 min-w-0 flex-1 text-sm break-words">
        {previewText(props.item)}
      </span>
      <RowActions {...props} />
    </li>
  );
}

/**
 * The messages the owner sent that wait for the Run (run-steering D11), above
 * the composer in delivery order. A queue item can steer or interrupt now; a
 * steer item can interrupt now; every item can be edited (withdrawn back into
 * the composer) or deleted. With no live Run nothing delivers on its own, and
 * the label says so.
 *
 * @summary pending steer and queue items above the composer
 */
export function PendingDeliveries({
  items,
  paused,
  ...actions
}: PendingDeliveriesProps) {
  if (items.length === 0) return null;
  return (
    <section aria-label="Pending messages" className="mb-2">
      {paused && (
        <p className="mb-1 px-1 text-xs text-muted-foreground">
          Paused — nothing runs until you send or steer an item
        </p>
      )}
      <ol className="flex flex-col gap-1">
        {items.map((item) => (
          <PendingRow key={item.id} item={item} {...actions} />
        ))}
      </ol>
    </section>
  );
}
