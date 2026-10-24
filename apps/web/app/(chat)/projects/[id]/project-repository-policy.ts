import type { CheckoutResponse } from "@/lib/services/checkouts/queries";
import type { IsolationPolicy } from "@/lib/services/project/types";

/**
 * The three isolation policies a project link carries, phrased as answers to
 * the setting's question — when does a chat start in its own worktree — so
 * the picker's trigger stays one short word or phrase, and the sentence under
 * it explains the choice. The Select's `items` map reads the same table.
 */
export const ISOLATION_OPTIONS: ReadonlyArray<{
  value: IsolationPolicy;
  label: string;
  description: string;
}> = [
  {
    value: "inherit",
    label: "When busy",
    description:
      "A chat starts in the checkout, or in its own worktree when another open chat already holds it.",
  },
  {
    value: "always_worktree",
    label: "Always",
    description: "Every chat starts in its own worktree.",
  },
  {
    value: "never",
    label: "Never",
    description:
      "Every chat starts in the checkout, even when another holds it.",
  },
];

const MACHINE_EXECUTOR = "machine:";

/** Whether the checkout lives on a Machine rather than this instance. */
export function isOnMachine(checkout: CheckoutResponse): boolean {
  return checkout.executorId.startsWith(MACHINE_EXECUTOR);
}

/** Where a checkout lives, in the words the reader knows it by: a Machine by
 *  its configured name, anything else as this instance's own executor. */
export function executorLabel(checkout: CheckoutResponse): string {
  return isOnMachine(checkout)
    ? checkout.executorId.slice(MACHINE_EXECUTOR.length)
    : "Local";
}

/** "1 checkout", "3 worktrees": a count with its noun, singular at one. */
export function countLabel(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}
