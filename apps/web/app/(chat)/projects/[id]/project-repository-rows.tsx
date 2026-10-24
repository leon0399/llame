"use client";

import * as React from "react";
import Link from "next/link";

import { Button } from "@workspace/ui/components/button";
import {
  FolderPlusIcon,
  GitBranchIcon,
  HardDriveIcon,
  ServerIcon,
  Trash2Icon,
} from "lucide-react";

import { ConfirmDeleteDialog } from "@/components/confirm-delete-dialog";
import { CopyPathButton } from "@/components/copy-path-button";
import { HoverReveal } from "@/components/hover-reveal";
import { IconButtonTooltip } from "@/components/icon-button-tooltip";
import { useChatQuery } from "@/lib/services/chat/queries";
import {
  useRegisterCheckout,
  useRemoveCheckoutWorktree,
} from "@/lib/services/checkouts/mutations";
import type { CheckoutResponse } from "@/lib/services/checkouts/queries";
import {
  findMachineByName,
  machinePathFromRoot,
} from "@/lib/services/machines/locator";
import { useMachinesQuery } from "@/lib/services/machines/queries";
import { repositoryFailureMessage } from "@/lib/services/repositories/failure";

import {
  DraftFailure,
  DraftField,
  DraftFloat,
  DraftLines,
} from "./project-repository-draft-row";
import { Refusal } from "./project-repository-dialogs";
import {
  countLabel,
  executorLabel,
  isOnMachine,
} from "./project-repository-policy";

/** A row's leading icon, aligned with the first line of its text. */
const ROW_ICON = "mt-0.5 size-4 shrink-0 text-muted-foreground";

/** One chat, by its title, as a link to it. A worktree records ids, and an id
 *  says nothing to a reader, so each one resolves through the owner chat
 *  read. */
function ChatReference({ chatId }: { chatId: string }) {
  const { data } = useChatQuery(chatId);
  if (data === undefined) {
    return <span className="text-muted-foreground">…</span>;
  }
  return (
    <Link
      href={`/chat/${chatId}`}
      prefetch={false}
      className="rounded-sm text-foreground underline-offset-2 outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
    >
      {data.title ?? "Untitled chat"}
    </Link>
  );
}

/** Keeps a row's hover actions in sight while its copy check shows. */
const KEEP_WHILE_COPIED =
  "group-has-[[data-copied]]/menu-item:grid-cols-revealed";

/** The copy control of a checkout or worktree row. */
function CopyLocationAction({ checkout }: { checkout: CheckoutResponse }) {
  return (
    <CopyPathButton
      location={checkout.path}
      trigger={<Button variant="ghost" size="icon-sm" />}
    />
  );
}

/** A checkout's path as a terminal where it lives takes it: a Machine
 *  checkout's locator decoded to the path on that Machine. */
function displayPath(checkout: CheckoutResponse) {
  return machinePathFromRoot(checkout.path) ?? checkout.path;
}

/** One registered clone: its path first, since that is what tells two
 *  clones apart, then where it lives and the branch it had. Copy shows on
 *  hover, like a sidebar row's actions. */
export function CheckoutRow({ checkout }: { checkout: CheckoutResponse }) {
  return (
    <li className="group/menu-item flex min-w-0 items-start gap-2 rounded-md px-2 py-1.5 hover:bg-accent">
      {isOnMachine(checkout) ? (
        <ServerIcon aria-hidden className={ROW_ICON} />
      ) : (
        <HardDriveIcon aria-hidden className={ROW_ICON} />
      )}
      <span className="flex min-w-0 flex-1 flex-col">
        <code className="truncate font-mono text-sm">
          {displayPath(checkout)}
        </code>
        <span className="truncate text-xs text-muted-foreground">
          <ExecutorLabel checkout={checkout} />
          {checkout.branch === null ? null : ` · ${checkout.branch}`}
        </span>
      </span>
      <HoverReveal className={KEEP_WHILE_COPIED}>
        <CopyLocationAction checkout={checkout} />
      </HoverReveal>
    </li>
  );
}

const MACHINE_STATE = { online: "Online", offline: "Offline" } as const;

/** A Machine's state as the dot the chat's Environment section uses. */
const STATE_DOT = {
  Online: "bg-success",
  Offline: "bg-destructive",
  Unknown: "bg-muted-foreground",
} as const;

/** Where a checkout lives: "Local", or its Machine's name after a dot that
 *  says whether llame can reach it right now — an offline Machine's rows
 *  still list, but nothing on them works until it is back. The state is
 *  spelled out for assistive tech, since the dot is color alone. */
function ExecutorLabel({ checkout }: { checkout: CheckoutResponse }) {
  const onMachine = isOnMachine(checkout);
  const machines = useMachinesQuery(onMachine);
  if (!onMachine) return <>{executorLabel(checkout)}</>;
  const machine = findMachineByName(machines.data, executorLabel(checkout));
  const state =
    machine === undefined ? "Unknown" : MACHINE_STATE[machine.status];
  // Plain inline content: a flex box here would sit on its own baseline and
  // grow the line, so the dot is an inline block centered on the text.
  return (
    <>
      <span
        aria-hidden="true"
        className={`mr-1 inline-block size-1.5 rounded-full align-middle ${STATE_DOT[state]}`}
      />
      {executorLabel(checkout)}
      <span className="sr-only">, {state}</span>
    </>
  );
}

/** Who holds the worktree: the chat that created it, and how many chats are
 *  bound to it besides. */
function WorktreeChats({ checkout }: { checkout: CheckoutResponse }) {
  const others = checkout.chatIds.filter(
    (chatId) => chatId !== checkout.leaseChatId,
  ).length;
  return (
    <span className="truncate text-xs text-muted-foreground">
      {isOnMachine(checkout) ? (
        <>
          <ExecutorLabel checkout={checkout} />
          {" · "}
        </>
      ) : null}
      {checkout.leaseChatId === null ? (
        "No chat recorded"
      ) : (
        <>
          From <ChatReference chatId={checkout.leaseChatId} />
        </>
      )}
      {others === 0 ? null : ` · ${countLabel(others, "other chat")}`}
    </span>
  );
}

/** The removal write: a refusal closes the confirmation and reaches the row,
 *  which keeps it listed beside the server's sentence. */
function useRemoveWorktree(
  checkout: CheckoutResponse,
  onOpenChange: (open: boolean) => void,
  onRefused: (message: string) => void,
) {
  const remove = useRemoveCheckoutWorktree();
  return {
    pending: remove.isPending,
    confirm: () =>
      remove.mutate(checkout.id, {
        onSuccess: () => onOpenChange(false),
        onError: (error) => {
          onOpenChange(false);
          onRefused(
            repositoryFailureMessage(error, "Couldn't remove the worktree."),
          );
        },
      }),
  };
}

/** The guarded removal: the route refuses a dirty tree or unpushed commits. */
function RemoveWorktreeDialog({
  checkout,
  open,
  onOpenChange,
  onRefused,
}: {
  checkout: CheckoutResponse;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onRefused: (message: string) => void;
}) {
  const remove = useRemoveWorktree(checkout, onOpenChange, onRefused);
  return (
    <ConfirmDeleteDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Remove worktree?"
      description={
        <>
          The directory at{" "}
          <code className="font-mono text-xs">{checkout.path}</code> is removed
          and its row forgotten. A dirty tree, an unpushed commit, or an unknown
          upstream refuses the removal; the branch stays either way.
        </>
      }
      confirmLabel="Remove"
      isPending={remove.pending}
      onConfirm={remove.confirm}
    />
  );
}

/** A worktree's copy and Remove, shown on hover like a sidebar row's. Each
 *  has its own reveal, so a copy's check stays in sight after the pointer
 *  leaves while Remove hides as usual. */
function WorktreeActions({
  checkout,
  onRemove,
}: {
  checkout: CheckoutResponse;
  onRemove: () => void;
}) {
  return (
    <span className="flex">
      <HoverReveal className={KEEP_WHILE_COPIED}>
        <CopyLocationAction checkout={checkout} />
      </HoverReveal>
      <HoverReveal>
        <IconButtonTooltip
          label="Remove worktree"
          size="icon-sm"
          onClick={onRemove}
        >
          <Trash2Icon />
        </IconButtonTooltip>
      </HoverReveal>
    </span>
  );
}

/** One worktree: its branch, the chats that hold it, and its hover actions —
 *  copy, which is how the path is reached, and the guarded Remove, whose
 *  confirmation names the path in full. A refusal stays under the row in the
 *  server's words. */
export function WorktreeRow({ checkout }: { checkout: CheckoutResponse }) {
  const [confirmOpen, setConfirmOpen] = React.useState(false);
  const [refusal, setRefusal] = React.useState<string | null>(null);

  return (
    <li className="group/menu-item flex min-w-0 flex-col gap-1 rounded-md px-2 py-1.5 hover:bg-accent">
      <span className="flex min-w-0 items-start gap-2">
        <GitBranchIcon aria-hidden className={ROW_ICON} />
        <span className="flex min-w-0 flex-1 flex-col">
          <code className="truncate font-mono text-sm">
            {checkout.branch ?? "Detached HEAD"}
          </code>
          <WorktreeChats checkout={checkout} />
        </span>
        <WorktreeActions
          checkout={checkout}
          onRemove={() => setConfirmOpen(true)}
        />
      </span>
      <Refusal message={refusal} />
      <RemoveWorktreeDialog
        checkout={checkout}
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        onRefused={setRefusal}
      />
    </li>
  );
}

function useNewCheckout(repositoryId: string, onDone: () => void) {
  const register = useRegisterCheckout();
  const [failure, setFailure] = React.useState<string | null>(null);
  const submit = (path: string) => {
    if (path === "" || register.isPending) return;
    setFailure(null);
    register.mutate(
      { path, repositoryId },
      {
        onSuccess: onDone,
        onError: (error) =>
          setFailure(
            repositoryFailureMessage(error, "Couldn't add the checkout."),
          ),
      },
    );
  };
  return { submit, failure, pending: register.isPending };
}

const DRAFT_CHECKOUT_ICON = <FolderPlusIcon aria-hidden className={ROW_ICON} />;

/** The row the section's `+` adds, the same draft the panel's repository
 *  list uses: Enter registers the path, Escape or an empty blur discards it. */
export function DraftCheckoutRow({
  repositoryId,
  onClose,
}: {
  repositoryId: string;
  onClose: () => void;
}) {
  const checkout = useNewCheckout(repositoryId, onClose);
  const [path, setPath] = React.useState("");
  const trimmed = path.trim();
  return (
    <li className="relative">
      <DraftLines
        icon={DRAFT_CHECKOUT_ICON}
        status={
          trimmed === ""
            ? "Paste the path to another clone"
            : "Enter registers this clone"
        }
      >
        <DraftField
          query={path}
          onQueryChange={setPath}
          onCancel={onClose}
          cancelOnBlur={trimmed === "" && !checkout.pending}
          onEnter={() => checkout.submit(trimmed)}
          placeholder="Path to a clone"
          label="Add checkout"
          monospace
        />
      </DraftLines>
      {checkout.failure === null ? null : (
        <DraftFloat>
          <DraftFailure message={checkout.failure} />
        </DraftFloat>
      )}
    </li>
  );
}
