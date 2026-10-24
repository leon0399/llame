import type { IsolationPolicy } from "@/lib/services/project/types";

/**
 * The three isolation policies a project link carries, in the order the picker
 * offers them, each with the sentence that explains what a chat start does.
 * The list and the picker both read this table, so a policy cannot be shown
 * with two different labels.
 */
export const ISOLATION_OPTIONS: ReadonlyArray<{
  value: IsolationPolicy;
  label: string;
  description: string;
}> = [
  {
    value: "inherit",
    label: "Reuse the checkout",
    description:
      "Starts in the checkout, and starts a worktree instead when another open chat already holds that checkout.",
  },
  {
    value: "always_worktree",
    label: "Always start a worktree",
    description:
      "Every chat start takes its own tree, so two chats never share one.",
  },
  {
    value: "never",
    label: "Never start a worktree",
    description: "Every chat start reuses the checkout.",
  },
];

/** The label of one policy; `undefined` for a value the table does not know. */
export function isolationLabel(isolation: IsolationPolicy): string {
  return (
    ISOLATION_OPTIONS.find((option) => option.value === isolation)?.label ??
    isolation
  );
}
