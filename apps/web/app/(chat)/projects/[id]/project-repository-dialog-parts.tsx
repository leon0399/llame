"use client";

import { useId, type ReactNode } from "react";

import { Alert, AlertTitle } from "@workspace/ui/components/alert";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@workspace/ui/components/dialog";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldLabel,
} from "@workspace/ui/components/field";
import { Input } from "@workspace/ui/components/input";
import { Label } from "@workspace/ui/components/label";
import { Switch } from "@workspace/ui/components/switch";
import { cn } from "@workspace/ui/lib/utils";

import { DialogSubmitFooter } from "@/components/dialog-submit-footer";
import type { RepositoryResponse } from "@/lib/services/repositories/queries";
import type { IsolationPolicy } from "@/lib/services/project/types";

import { ISOLATION_OPTIONS } from "./project-repository-policy";

/** The frame every repository dialog shares; the body is a child so its fields
 *  live BELOW `DialogContent` and re-seed each time the dialog opens. */
export function RepositoryDialogFrame({
  open,
  onOpenChange,
  title,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  children: ReactNode;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        {children}
      </DialogContent>
    </Dialog>
  );
}

/** The footer every form here ends with: the server's refusal, when there is
 *  one, then the Cancel + submit pair. */
export function DialogFormFooter({
  failure,
  onCancel,
  onSubmit,
  submitLabel,
  submitDisabled,
}: {
  failure: string | null;
  onCancel: () => void;
  onSubmit: () => void;
  submitLabel: string;
  submitDisabled: boolean;
}) {
  return (
    <>
      {failure === null ? null : (
        <Alert variant="destructive">
          <AlertTitle>{failure}</AlertTitle>
        </Alert>
      )}
      <DialogSubmitFooter
        onCancel={onCancel}
        onSubmit={onSubmit}
        submitLabel={submitLabel}
        submitDisabled={submitDisabled}
      />
    </>
  );
}

function RepositoryOption({
  selected,
  onSelect,
  label,
  detail,
}: {
  selected: boolean;
  onSelect: () => void;
  label: string;
  detail?: string;
}) {
  return (
    <button
      type="button"
      // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- a row is a display name over its remote, and <option> cannot render two lines
      role="option"
      aria-selected={selected}
      onClick={onSelect}
      className={cn(
        "flex flex-col items-start gap-0.5 rounded-sm px-2 py-1.75 text-left text-sm hover:bg-accent",
        selected && "bg-accent",
      )}
    >
      <span>{label}</span>
      {detail === undefined ? null : (
        <code className="font-mono text-xs break-all text-muted-foreground">
          {detail}
        </code>
      )}
    </button>
  );
}

/**
 * The catalog picker, following the org-unit move picker: a custom listbox
 * rather than a native `<select>`, because each row carries a display name and
 * the remote it resolves to, which `<option>` cannot render.
 */
function RepositoryPicker({
  repositories,
  selectedId,
  onSelect,
  noneLabel,
}: {
  repositories: ReadonlyArray<RepositoryResponse>;
  selectedId: string | null;
  onSelect: (repositoryId: string | null) => void;
  noneLabel?: string;
}) {
  return (
    <div
      // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- see the option row above
      role="listbox"
      aria-label="Repository"
      className="flex max-h-60 flex-col gap-px overflow-y-auto rounded-md border p-1"
    >
      {noneLabel === undefined ? null : (
        <RepositoryOption
          selected={selectedId === null}
          onSelect={() => onSelect(null)}
          label={noneLabel}
        />
      )}
      {repositories.map((repository) => (
        <RepositoryOption
          key={repository.id}
          selected={selectedId === repository.id}
          onSelect={() => onSelect(repository.id)}
          label={repository.displayName}
          detail={repository.canonicalRemote ?? "No remote"}
        />
      ))}
    </div>
  );
}

/** The labelled picker block: the row label, the picker or the reason it has
 *  no options, and the one line that explains what the choice does. */
export function RepositoryField({
  repositories,
  selectedId,
  onSelect,
  noneLabel,
  hint,
  emptyNote,
}: {
  repositories: ReadonlyArray<RepositoryResponse>;
  selectedId: string | null;
  onSelect: (repositoryId: string | null) => void;
  noneLabel?: string;
  hint?: string;
  emptyNote?: string;
}) {
  return (
    <div className="space-y-2">
      <p className="text-sm font-medium">Repository</p>
      {emptyNote !== undefined && repositories.length === 0 ? (
        <p className="text-sm text-muted-foreground">{emptyNote}</p>
      ) : (
        <RepositoryPicker
          repositories={repositories}
          selectedId={selectedId}
          onSelect={onSelect}
          noneLabel={noneLabel}
        />
      )}
      {hint === undefined ? null : (
        <p className="text-xs text-muted-foreground">{hint}</p>
      )}
    </div>
  );
}

/** The isolation policy picker: three pressed states over one value. */
export function IsolationPicker({
  value,
  onChange,
}: {
  value: IsolationPolicy;
  onChange: (isolation: IsolationPolicy) => void;
}) {
  return (
    <fieldset className="m-0 space-y-2 border-0 p-0">
      <legend className="text-sm font-medium">Isolation</legend>
      <div className="flex flex-col gap-1.5">
        {ISOLATION_OPTIONS.map((option) => {
          const selected = value === option.value;
          return (
            <button
              key={option.value}
              type="button"
              aria-pressed={selected}
              onClick={() => onChange(option.value)}
              className={cn(
                "rounded-md border px-3 py-2 text-left transition-colors hover:bg-accent",
                selected && "border-foreground/35 bg-accent",
              )}
            >
              <span className="block text-sm font-medium">{option.label}</span>
              <span className="block text-xs text-muted-foreground">
                {option.description}
              </span>
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}

export function PrimaryField({
  isPrimary,
  onIsPrimaryChange,
}: {
  isPrimary: boolean;
  onIsPrimaryChange: (isPrimary: boolean) => void;
}) {
  const id = useId();
  return (
    <Field orientation="horizontal">
      <FieldContent>
        <FieldLabel htmlFor={id}>Primary repository</FieldLabel>
        <FieldDescription>
          A chat start on this project prefers the primary link. A project holds
          at most one.
        </FieldDescription>
      </FieldContent>
      <Switch id={id} checked={isPrimary} onCheckedChange={onIsPrimaryChange} />
    </Field>
  );
}

export function AliasField({
  alias,
  onAliasChange,
  placeholder,
}: {
  alias: string;
  onAliasChange: (alias: string) => void;
  placeholder?: string;
}) {
  const id = useId();
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>Alias</Label>
      <Input
        id={id}
        value={alias}
        onChange={(event) => onAliasChange(event.target.value)}
        maxLength={200}
        placeholder={placeholder}
      />
    </div>
  );
}
