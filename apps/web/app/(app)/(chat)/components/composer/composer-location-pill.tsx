"use client";

import type { ReactNode } from "react";
import {
  AlertTriangleIcon,
  ChevronDownIcon,
  GitBranchIcon,
  MonitorIcon,
} from "lucide-react";

import { Button } from "@workspace/ui/components/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu";

import { ComposerTooltip } from "./composer-tooltip";
import type { ComposerLocation } from "./use-composer-location";

/*
 * The working directory's own controls in the row under the input (design
 * D10), after the folder: the Machine when there is a choice of one (or when
 * it cannot serve), the mode (the checkout or a new worktree), and Retry when
 * the location could not be resolved. A warning sits on the control it is
 * about, never as a separate icon: an unusable Machine is named on the
 * Machine control and explained at the top of its menu.
 */

type Choice = {
  id: string;
  label: string;
  /** A path or the reason the choice is unavailable, on a second line. */
  detail?: string;
  disabled?: boolean;
};

/** One choice: its label over a detail line (a path, or why it is disabled). */
function ChoiceItem({ choice }: { choice: Choice }) {
  return (
    <DropdownMenuRadioItem
      closeOnClick
      value={choice.id}
      disabled={choice.disabled}
      aria-label={
        choice.detail === undefined
          ? choice.label
          : `${choice.label}: ${choice.detail}`
      }
    >
      <span className="flex min-w-0 flex-col">
        <span className="truncate">{choice.label}</span>
        {choice.detail === undefined ? null : (
          <span className="text-muted-foreground truncate text-xs">
            {choice.detail}
          </span>
        )}
      </span>
    </DropdownMenuRadioItem>
  );
}

/** One labelled radio group of a control's menu. */
function ChoiceGroup({
  title,
  choices,
  value,
  onValueChange,
}: {
  title: string;
  choices: Array<Choice>;
  value: string | null;
  onValueChange: (id: string) => void;
}) {
  return (
    <DropdownMenuGroup>
      <DropdownMenuLabel>{title}</DropdownMenuLabel>
      <DropdownMenuRadioGroup value={value ?? ""} onValueChange={onValueChange}>
        {choices.map((choice) => (
          <ChoiceItem key={choice.id} choice={choice} />
        ))}
      </DropdownMenuRadioGroup>
    </DropdownMenuGroup>
  );
}

type StartRowMenuProps = {
  tooltip: string;
  ariaLabel: string;
  icon: ReactNode;
  label: ReactNode;
  children: ReactNode;
  /** How it gives way on a narrow row: `shrink` (the default) cuts its
   *  name, `icon` keeps its size and shows only its icon, `none` keeps its
   *  whole label (a short word whose loss would make the control
   *  ambiguous). */
  narrow?: "shrink" | "icon" | "none";
};

const LABEL_FIT = {
  shrink:
    "min-w-0 overflow-x-clip font-normal text-ellipsis whitespace-nowrap text-trim-cap",
  icon: "font-normal text-trim-cap @max-md:sr-only",
  none: "font-normal whitespace-nowrap text-trim-cap",
} as const;

/** One control of the row under the input: icon, name and a chevron,
 *  opening a menu. The name is trimmed to its cap height so the icon lines
 *  up with the letters, and clipped only sideways so descenders survive. */
function StartRowMenu(props: StartRowMenuProps) {
  return (
    <DropdownMenu>
      <ComposerTooltip
        label={props.tooltip}
        render={
          <DropdownMenuTrigger
            render={
              <Button
                type="button"
                variant="ghost"
                size="xs"
                aria-label={props.ariaLabel}
                className={
                  (props.narrow ?? "shrink") === "shrink"
                    ? "min-w-0 shrink"
                    : "shrink-0"
                }
              />
            }
          />
        }
      >
        {props.icon}
        <span className={LABEL_FIT[props.narrow ?? "shrink"]}>
          {props.label}
        </span>
        <ChevronDownIcon aria-hidden className="opacity-60 @max-xs:hidden" />
      </ComposerTooltip>
      <DropdownMenuContent align="start" className="max-h-96 w-64">
        {props.children}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * A Machine choice selects a `main` checkout of the repository on it at once —
 * the first by path when it holds several — so the row never passes through
 * an unresolved state. The folder control then changes the checkout.
 */
function selectMachine(location: ComposerLocation, executorId: string) {
  const [first] = location.checkouts
    .filter(
      (row) =>
        row.kind === "main" &&
        row.executorId === executorId &&
        row.repositoryId === location.location.repositoryId,
    )
    .sort((left, right) => left.path.localeCompare(right.path));

  if (first !== undefined) location.selectWorkingDirectory(first);
}

/** The short state an unusable Machine shows beside its name: "offline" for
 *  a Machine that does not answer, "unavailable" for any other reason (an
 *  identity change, a daemon too old, a name not configured). */
function machineState(reason: string): string {
  return reason.startsWith("Offline") || reason.endsWith("offline.")
    ? "offline"
    : "unavailable";
}

/** The Machine's name, and its state when it cannot serve the chat. The
 *  state keeps the label's own color: destructive text this small on the
 *  control's hover fill falls below AA contrast, so the red is the icon's. */
function machineLabel(name: string, reason: string | null): string {
  return reason === null ? name : `${name} · ${machineState(reason)}`;
}

/** Why the chosen Machine cannot serve, at the top of its menu. */
function MachineWarning({ reason }: { reason: string | null }) {
  if (reason === null) return null;

  return (
    <p className="flex gap-1.5 px-1.5 py-1 text-xs text-destructive [&>svg]:mt-px [&>svg]:size-3.5 [&>svg]:shrink-0">
      <AlertTriangleIcon aria-hidden />
      {reason}
    </p>
  );
}

/** The Machine control: when the repository is on more than one Machine,
 *  since a single choice is no choice, or when the one chosen cannot serve,
 *  which it then says. An unusable Machine is listed disabled with its
 *  reason. */
function MachineControl({ location }: { location: ComposerLocation }) {
  const executor = location.location.executor;
  const reason = executor?.reason ?? null;

  if (location.machineOptions.length < 2 && reason === null) return null;

  const name = executor?.label ?? "No checkout";

  return (
    <StartRowMenu
      tooltip={reason === null ? "Machine" : `${name}: ${reason}`}
      ariaLabel={
        reason === null ? `Machine, ${name}` : `Machine, ${name}, ${reason}`
      }
      icon={
        <MonitorIcon
          aria-hidden
          className={reason === null ? undefined : "text-destructive"}
        />
      }
      label={machineLabel(name, reason)}
      narrow="icon"
    >
      <MachineWarning reason={reason} />
      <ChoiceGroup
        title="Machine"
        value={executor?.executorId ?? null}
        onValueChange={(executorId) => selectMachine(location, executorId)}
        choices={location.machineOptions.map((option) => ({
          id: option.executorId,
          label: option.label,
          detail: option.reason ?? undefined,
          disabled: option.reason !== null,
        }))}
      />
    </StartRowMenu>
  );
}

/**
 * Where in the checkout the chat works, named by its current mode so the
 * control reads the same at every width: "Checkout" works in the checkout on
 * its branch, "Worktree" starts a new worktree cut from that branch (named by
 * the server).
 */
function ModeControl({ location }: { location: ComposerLocation }) {
  const branch = location.location.checkout?.branch ?? "detached HEAD";
  const worktree = location.isolation === "worktree";

  return (
    <StartRowMenu
      tooltip={
        worktree
          ? `New worktree from ${branch}`
          : `Work in the checkout on ${branch}`
      }
      ariaLabel={`Mode, ${worktree ? "new worktree" : "checkout"}`}
      icon={<GitBranchIcon aria-hidden />}
      label={worktree ? "Worktree" : "Checkout"}
      narrow="none"
    >
      <ChoiceGroup
        title="Work in"
        value={worktree ? "worktree" : "reuse"}
        onValueChange={(mode) =>
          location.selectIsolation(mode === "worktree" ? "worktree" : "reuse")
        }
        choices={[
          { id: "reuse", label: "The checkout", detail: `On ${branch}` },
          {
            id: "worktree",
            label: "A new worktree",
            detail: `Cut from ${branch}`,
          },
        ]}
      />
    </StartRowMenu>
  );
}

/** The location could not be resolved: the one warning with something to
 *  do, so a button, with the message in its tooltip. */
function RetryControl({ location }: { location: ComposerLocation }) {
  const warning = location.location.warning;

  if (warning?.step !== "preview") return null;

  return (
    <ComposerTooltip
      label={warning.message}
      render={
        <Button
          type="button"
          variant="ghost"
          size="xs"
          onClick={location.preview.refetch}
        />
      }
    >
      <AlertTriangleIcon aria-hidden className="text-destructive" />
      <span className="font-normal text-trim-cap">Retry</span>
    </ComposerTooltip>
  );
}

/** The working directory's own controls; nothing while none resolves. */
export function ComposerLocationPill({
  location,
}: {
  location: ComposerLocation;
}) {
  if (location.location.checkout === null) {
    return <RetryControl location={location} />;
  }

  return (
    <>
      <MachineControl location={location} />
      <ModeControl location={location} />
      <RetryControl location={location} />
    </>
  );
}
