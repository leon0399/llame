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
  notice: "Notice",
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
  if (item.producer === "job") return `${item.job} ${item.jobState}`;
  const text = deliveryText(item);

  if (text !== "") return text;
  const files = deliveryFiles(item).length;

  return files === 1 ? "1 attachment" : `${files} attachments`;
}

/** The accessible name of a row button: the action and a short excerpt of the
 *  item, so rows with the same actions stay apart. */
function actionName(action: string, item: ChatDeliveryResponse) {
  const preview = previewText(item);
  const excerpt = preview.length > 40 ? `${preview.slice(0, 40)}…` : preview;

  return `${action}: ${excerpt}`;
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
          aria-label={actionName("Steer now", item)}
          size="icon-sm"
          onClick={() => onSteerNow(item)}
        >
          <CornerDownRightIcon />
        </IconButtonTooltip>
      )}
      {item.mode !== "interrupt" && (
        <IconButtonTooltip
          label="Interrupt now"
          aria-label={actionName("Interrupt now", item)}
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
      {item.producer === "owner" && (
        <>
          <HurryActions {...hurry} />
          <IconButtonTooltip
            label="Edit"
            aria-label={actionName("Edit", item)}
            size="icon-sm"
            onClick={() => onEdit(item)}
          >
            <PencilIcon />
          </IconButtonTooltip>
        </>
      )}
      <IconButtonTooltip
        label="Delete"
        aria-label={actionName("Delete", item)}
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
 * Pending owner messages and job notices above the composer, in delivery
 * order. Owner items can be hurried, edited, or
 * deleted. A job notice shows its locator and state, and offers delete only.
 * With no live Run, pending owner items are labelled paused.
 *
 * @summary producer-aware pending items above the composer
 */
export function PendingDeliveries({
  items,
  paused,
  ...actions
}: PendingDeliveriesProps) {
  if (items.length === 0) return null;

  return (
    <section aria-label="Pending messages" className="mb-2">
      {paused && items.some((item) => item.producer === "owner") && (
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
