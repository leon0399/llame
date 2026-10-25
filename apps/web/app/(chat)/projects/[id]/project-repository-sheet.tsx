"use client";

import { useId, useRef, useState, type ReactNode } from "react";

import { Input } from "@workspace/ui/components/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@workspace/ui/components/select";
import { Separator } from "@workspace/ui/components/separator";
import { Skeleton } from "@workspace/ui/components/skeleton";
import { Sheet, SheetContent } from "@workspace/ui/components/sheet";
import { Switch } from "@workspace/ui/components/switch";
import { PlusIcon } from "lucide-react";

import { IconButtonTooltip } from "@/components/icon-button-tooltip";
import type { CheckoutResponse } from "@/lib/services/checkouts/queries";
import { useUpdateProjectRepositoryLink } from "@/lib/services/project/mutations";
import type {
  IsolationPolicy,
  ProjectRepositoryLink,
} from "@/lib/services/project/types";
import { repositoryFailureMessage } from "@/lib/services/repositories/failure";
import type { RepositoryResponse } from "@/lib/services/repositories/queries";

import { Refusal } from "./project-repository-dialogs";
import { ISOLATION_OPTIONS } from "./project-repository-policy";
import { RepositoryHeader } from "./project-repository-sheet-header";
import {
  CheckoutRow,
  DraftCheckoutRow,
  WorktreeRow,
} from "./project-repository-rows";

/** One band of the sheet: a small heading with its count and action, then
 *  its content. Bands are divided by rules, not boxed. */
function SheetSection({
  title,
  count,
  action,
  children,
}: {
  title: string;
  count?: number;
  action?: ReactNode;
  children: ReactNode;
}) {
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} className="space-y-1 px-4 py-3">
      <div className="flex h-8 items-center justify-between gap-2">
        <h3
          id={headingId}
          className="text-xs font-medium text-muted-foreground"
        >
          {title}
          {count === undefined ? null : <span className="ml-1">{count}</span>}
        </h3>
        {action}
      </div>
      {children}
    </section>
  );
}

/** One setting as a row: its label on the left, its control on the right,
 *  and an optional sentence under the control. */
function PropertyRow({
  label,
  htmlFor,
  hint,
  children,
}: {
  label: string;
  htmlFor: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex items-start gap-3 py-1">
      <label
        htmlFor={htmlFor}
        className="flex h-8 w-24 shrink-0 items-center text-sm text-muted-foreground"
      >
        {label}
      </label>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        {children}
        {hint === undefined ? null : (
          <p className="text-xs text-muted-foreground">{hint}</p>
        )}
      </div>
    </div>
  );
}

/** Settings save as they change: a switch or a choice writes at once, and the
 *  name writes when the field is left. A refusal shows under the settings. */
function useLinkSettings(projectId: string, link: ProjectRepositoryLink) {
  const update = useUpdateProjectRepositoryLink();
  const [failure, setFailure] = useState<string | null>(null);
  const save = (patch: {
    alias?: string;
    isPrimary?: boolean;
    isolation?: IsolationPolicy;
  }) => {
    setFailure(null);
    update.mutate(
      { projectId, repositoryId: link.repositoryId, ...patch },
      {
        onError: (error) =>
          setFailure(repositoryFailureMessage(error, "Couldn't save.")),
      },
    );
  };
  return { save, failure, pending: update.isPending };
}

function NameField({
  id,
  alias,
  onCommit,
}: {
  id: string;
  alias: string;
  onCommit: (alias: string) => void;
}) {
  const [value, setValue] = useState(alias);
  const commit = () => {
    const next = value.trim();
    if (next === "") return setValue(alias);
    if (next !== alias) onCommit(next);
  };
  return (
    <Input
      id={id}
      value={value}
      maxLength={200}
      onChange={(event) => setValue(event.target.value)}
      onBlur={commit}
      // Enter leaves the field, so the blur is the one commit: committing
      // here as well would write twice before the refetch lands.
      onKeyDown={(event) => {
        if (event.key === "Enter") event.currentTarget.blur();
      }}
    />
  );
}

const ISOLATION_ITEMS = ISOLATION_OPTIONS.map(({ label, value }) => ({
  label,
  value,
}));

function IsolationSelect({
  id,
  value,
  disabled,
  onChange,
}: {
  id: string;
  value: IsolationPolicy;
  disabled: boolean;
  onChange: (isolation: IsolationPolicy) => void;
}) {
  return (
    <Select
      items={ISOLATION_ITEMS}
      value={value}
      disabled={disabled}
      onValueChange={(next) => {
        if (next !== null) onChange(next);
      }}
    >
      <SelectTrigger id={id} className="w-full">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {ISOLATION_OPTIONS.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function PrimaryRow({
  checked,
  disabled,
  onChange,
}: {
  checked: boolean;
  disabled: boolean;
  onChange: (isPrimary: boolean) => void;
}) {
  const id = useId();
  return (
    <PropertyRow label="Primary" htmlFor={id}>
      <span className="flex h-8 items-center">
        <Switch
          id={id}
          checked={checked}
          disabled={disabled}
          onCheckedChange={onChange}
        />
      </span>
    </PropertyRow>
  );
}

function IsolationRow({
  value,
  disabled,
  onChange,
}: {
  value: IsolationPolicy;
  disabled: boolean;
  onChange: (isolation: IsolationPolicy) => void;
}) {
  const id = useId();
  return (
    <PropertyRow
      label="Worktrees"
      htmlFor={id}
      hint={
        ISOLATION_OPTIONS.find((option) => option.value === value)?.description
      }
    >
      <IsolationSelect
        id={id}
        value={value}
        disabled={disabled}
        onChange={onChange}
      />
    </PropertyRow>
  );
}

/** How this project names and uses the repository. */
function SettingsSection({
  projectId,
  link,
}: {
  projectId: string;
  link: ProjectRepositoryLink;
}) {
  const settings = useLinkSettings(projectId, link);
  const nameId = useId();
  return (
    <SheetSection title="In this project">
      <PropertyRow label="Name" htmlFor={nameId}>
        <NameField
          key={link.alias}
          id={nameId}
          alias={link.alias}
          onCommit={(alias) => settings.save({ alias })}
        />
      </PropertyRow>
      <PrimaryRow
        checked={link.isPrimary}
        disabled={settings.pending}
        onChange={(isPrimary) => settings.save({ isPrimary })}
      />
      <IsolationRow
        value={link.isolation}
        disabled={settings.pending}
        onChange={(isolation) => settings.save({ isolation })}
      />
      <p className="text-xs text-muted-foreground">
        Primary and Worktrees are kept for starting chats in this project's
        repositories, which is not available yet.
      </p>
      <Refusal message={settings.failure} />
    </SheetSection>
  );
}

/** A repository's checkouts once read, or why they are not shown yet. */
export type CheckoutsRead =
  | { status: "loading" }
  | { status: "error" }
  | { status: "loaded"; rows: ReadonlyArray<CheckoutResponse> };

/** One kind of checkout from a read, the read's state passing through. */
function ofKind(
  read: CheckoutsRead,
  kind: CheckoutResponse["kind"],
): CheckoutsRead {
  if (read.status !== "loaded") return read;
  return {
    status: "loaded",
    rows: read.rows.filter((checkout) => checkout.kind === kind),
  };
}

/** A group's rows, spaced like the panel's repository list so two filled
 *  rows never touch; the sentence that says why it has none; or the read's
 *  pending or failed state. */
function RowList({
  read,
  empty,
  row,
  draft,
}: {
  read: CheckoutsRead;
  empty: string;
  row: (checkout: CheckoutResponse) => ReactNode;
  draft?: ReactNode;
}) {
  if (read.status === "loading") return <Skeleton className="h-10 w-full" />;
  if (read.status === "error") {
    return (
      <p className="py-1 text-sm text-muted-foreground">
        Could not load the checkouts.
      </p>
    );
  }
  if (read.rows.length === 0 && draft === undefined) {
    return <p className="py-1 text-sm text-muted-foreground">{empty}</p>;
  }
  return (
    <ul className="-mx-2 flex flex-col gap-1">
      {read.rows.map(row)}
      {draft}
    </ul>
  );
}

/** A section heading's count, once there is one to show. */
function countOf(read: CheckoutsRead) {
  return read.status === "loaded" ? read.rows.length : undefined;
}

function checkoutRow(checkout: CheckoutResponse) {
  return <CheckoutRow key={checkout.id} checkout={checkout} />;
}

const NO_CHECKOUT =
  "No checkout yet. Add the path of a clone so chats can start in it.";

function CheckoutsSection({
  repositoryId,
  checkouts,
}: {
  repositoryId: string;
  checkouts: CheckoutsRead;
}) {
  const [drafting, setDrafting] = useState(false);
  return (
    <SheetSection
      title="Checkouts"
      count={countOf(checkouts)}
      action={
        <IconButtonTooltip
          label="Add checkout"
          size="icon-sm"
          disabled={drafting}
          onClick={() => setDrafting(true)}
        >
          <PlusIcon />
        </IconButtonTooltip>
      }
    >
      <RowList
        read={checkouts}
        empty={NO_CHECKOUT}
        row={checkoutRow}
        draft={
          drafting ? (
            <DraftCheckoutRow
              repositoryId={repositoryId}
              onClose={() => setDrafting(false)}
            />
          ) : undefined
        }
      />
    </SheetSection>
  );
}

function WorktreesSection({ worktrees }: { worktrees: CheckoutsRead }) {
  return (
    <SheetSection title="Worktrees" count={countOf(worktrees)}>
      <RowList
        read={worktrees}
        empty="None yet. Chats that start in their own worktree add it here."
        row={(checkout) => (
          <WorktreeRow key={checkout.id} checkout={checkout} />
        )}
      />
    </SheetSection>
  );
}

type RepositorySheetProps = {
  projectId: string;
  link: ProjectRepositoryLink;
  repository: RepositoryResponse | undefined;
  checkouts: CheckoutsRead;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

/**
 * Everything about one linked repository, opened from its row: how this
 * project names and uses it, the clones it starts chats in, and the worktrees
 * those chats made. Unlink sits in the header's menu, beside close. The
 * panel row stays one line; this sheet is where the detail lives.
 *
 * @summary manage one linked repository: settings, checkouts, worktrees
 */
export function RepositorySheet({
  open,
  onOpenChange,
  ...props
}: RepositorySheetProps) {
  const { projectId, link, checkouts } = props;
  // Focused on open instead of the first control, whose tooltip would open.
  const body = useRef<HTMLDivElement>(null);
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        initialFocus={body}
        showCloseButton={false}
        className="overflow-y-auto sm:max-w-md"
      >
        <div ref={body} tabIndex={-1} className="flex flex-col outline-none">
          <RepositoryHeader {...props} />
          <Separator />
          <SettingsSection projectId={projectId} link={link} />
          <Separator />
          <CheckoutsSection
            repositoryId={link.repositoryId}
            checkouts={ofKind(checkouts, "main")}
          />
          <Separator />
          <WorktreesSection worktrees={ofKind(checkouts, "worktree")} />
        </div>
      </SheetContent>
    </Sheet>
  );
}
