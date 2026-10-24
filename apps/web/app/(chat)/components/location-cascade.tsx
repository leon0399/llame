"use client";

import { useId } from "react";

import { Alert, AlertTitle } from "@workspace/ui/components/alert";
import { Button } from "@workspace/ui/components/button";
import { Input } from "@workspace/ui/components/input";
import { Label } from "@workspace/ui/components/label";
import { cn } from "@workspace/ui/lib/utils";
import { CheckIcon } from "lucide-react";

import type { StartLocationIsolation } from "@/lib/services/project/start-location";

import type { ComposerLocation } from "./use-composer-location";

/*
 * The cascade popover of design D10: the resolved location as stacked levels —
 * project, repository, machine, source checkout, isolation — then the worktree
 * base ref and name. Each level writes to the one resolved-location module;
 * the module recomputes the levels below from their defaults.
 */

type LevelOption = {
  id: string;
  label: string;
  /** A path, a branch, or the reason the option cannot be chosen. */
  detail?: string;
  disabled?: boolean;
};

type OptionRowProps = {
  option: LevelOption;
  selected: boolean;
  onSelect: (id: string) => void;
};

function OptionRow({ option, selected, onSelect }: OptionRowProps) {
  return (
    <button
      type="button"
      // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- a row carries a label over a detail line, which <option> cannot render
      role="option"
      aria-selected={selected}
      aria-label={
        option.disabled && option.detail !== undefined
          ? `${option.label}: ${option.detail}`
          : undefined
      }
      disabled={option.disabled}
      onClick={() => onSelect(option.id)}
      className={cn(
        "flex flex-col items-start gap-0.5 rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent",
        selected && "bg-accent",
      )}
    >
      <span className="flex items-center gap-1.5">
        <CheckIcon
          size={12}
          className={cn("shrink-0", !selected && "invisible")}
        />
        {option.label}
      </span>
      {option.detail === undefined ? null : (
        <span className="pl-4 text-xs break-all">{option.detail}</span>
      )}
    </button>
  );
}

type ChoiceLevelProps = {
  title: string;
  options: Array<LevelOption>;
  selectedId: string | null;
  onSelect: (id: string) => void;
  /** What to say when the level has no option at all. */
  empty?: string;
  /** The reason label under the list (isolation). */
  hint?: string;
};

/** One cascade level: a labelled listbox of the values the module offers. */
function ChoiceLevel({
  title,
  options,
  selectedId,
  onSelect,
  empty,
  hint,
}: ChoiceLevelProps) {
  return (
    <div className="space-y-1">
      <h3 className="text-xs font-medium text-muted-foreground">{title}</h3>
      {options.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {empty ?? "No choice is available."}
        </p>
      ) : (
        <div
          // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- see the option row
          role="listbox"
          aria-label={title}
          className="flex max-h-40 flex-col gap-px overflow-y-auto rounded-md border p-1"
        >
          {options.map((option) => (
            <OptionRow
              key={option.id}
              option={option}
              selected={option.id === selectedId}
              onSelect={onSelect}
            />
          ))}
        </div>
      )}
      {hint === undefined ? null : (
        <p className="text-xs text-muted-foreground">{hint}</p>
      )}
    </div>
  );
}

const ISOLATION_CHOICES: ReadonlyArray<{
  value: StartLocationIsolation;
  label: string;
}> = [
  { value: "reuse", label: "Reuse the checkout" },
  { value: "worktree", label: "Start a worktree" },
];

function isIsolationChoice(value: string): value is StartLocationIsolation {
  return value === "reuse" || value === "worktree";
}

type WorktreeFieldProps = {
  id: string;
  label: string;
  value: string;
  placeholder: string;
  onChange: (value: string) => void;
};

function WorktreeField({
  id,
  label,
  value,
  placeholder,
  onChange,
}: WorktreeFieldProps) {
  return (
    <div className="space-y-1">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  );
}

/** The worktree fields, shown only while the isolation asks for a worktree. */
function WorktreeFields({ location }: { location: ComposerLocation }) {
  const id = useId();
  return (
    <div className="grid grid-cols-2 gap-2">
      <WorktreeField
        id={`${id}-base`}
        label="Base ref"
        value={location.baseRef}
        placeholder="HEAD"
        onChange={location.setBaseRef}
      />
      <WorktreeField
        id={`${id}-name`}
        label="Name"
        value={location.worktreeName}
        placeholder="Generated"
        onChange={location.setWorktreeName}
      />
    </div>
  );
}

function RepositoryLevel({ location }: { location: ComposerLocation }) {
  if (location.repositoryOptions.length <= 1) return null;
  return (
    <ChoiceLevel
      title="Repository"
      selectedId={location.location.repositoryId}
      onSelect={location.selectRepository}
      options={location.repositoryOptions.map((option) => ({
        id: option.id,
        label: option.label,
        detail: option.isPrimary ? "Primary" : undefined,
      }))}
    />
  );
}

function machineDetail(reason: string | null, mainCheckouts: number): string {
  if (reason !== null) return reason;
  return mainCheckouts === 1
    ? "1 checkout"
    : `${String(mainCheckouts)} checkouts`;
}

function MachineLevel({ location }: { location: ComposerLocation }) {
  return (
    <ChoiceLevel
      title="Machine"
      selectedId={location.location.executor?.executorId ?? null}
      onSelect={location.selectExecutor}
      empty="No Machine holds a checkout of this repository."
      options={location.machineOptions.map((option) => ({
        id: option.executorId,
        label: option.label,
        detail: machineDetail(option.reason, option.mainCheckouts),
        disabled: option.reason !== null,
      }))}
    />
  );
}

function CheckoutLevel({ location }: { location: ComposerLocation }) {
  if (location.checkoutChoices.length <= 1) return null;
  return (
    <ChoiceLevel
      title="Source checkout"
      selectedId={location.location.checkout?.id ?? null}
      onSelect={location.selectCheckout}
      options={location.checkoutChoices.map((option) => ({
        id: option.id,
        label: option.path,
        detail: option.branch ?? "Detached HEAD",
      }))}
    />
  );
}

function IsolationLevel({ location }: { location: ComposerLocation }) {
  return (
    <ChoiceLevel
      title="Isolation"
      selectedId={location.isolation}
      onSelect={(value) => {
        if (isIsolationChoice(value)) location.selectIsolation(value);
      }}
      hint={location.isolationLabel}
      options={ISOLATION_CHOICES.map((option) => ({
        id: option.value,
        label: option.label,
      }))}
    />
  );
}

/** The popover body; the chip trigger wraps it. */
export function LocationCascade({ location }: { location: ComposerLocation }) {
  const warning = location.location.warning;
  return (
    <div className="flex max-h-96 flex-col gap-4 overflow-y-auto">
      <div className="space-y-1">
        <h3 className="text-xs font-medium text-muted-foreground">Project</h3>
        <p className="text-sm">{location.projectName}</p>
      </div>
      <RepositoryLevel location={location} />
      <MachineLevel location={location} />
      <CheckoutLevel location={location} />
      <IsolationLevel location={location} />
      {location.isolation === "worktree" ? (
        <WorktreeFields location={location} />
      ) : null}
      {warning === null ? null : (
        <Alert variant="destructive">
          <AlertTitle>{warning.message}</AlertTitle>
        </Alert>
      )}
      {location.preview.failed ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={location.preview.refetch}
        >
          Try again
        </Button>
      ) : null}
    </div>
  );
}
