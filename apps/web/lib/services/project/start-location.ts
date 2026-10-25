import { keepPreviousData, useQuery } from "@tanstack/react-query";

import type {
  CheckoutResponse,
  CreationWorkspaceResponseStatus,
  GetProjectStartLocationParams,
  MachineResponse,
  RepositoryResponse,
  StartLocationResponse,
} from "../../api/generated/models";
import { getProjectStartLocation } from "../../api/generated/projects/projects";
import { createAuthenticatedBrowserFetch } from "../../api/fetch";
import { MACHINE_FAILURE_LABELS } from "../machines/labels";
import { findMachineByName } from "../machines/locator";
import { projectQueryKeys } from "./queries";
import type {
  StartLocationIsolation,
  StartLocationSelection,
} from "./start-location-link";
import type { ProjectRepositoryLink } from "./types";

export type { StartLocationResponse };

/*
 * The one resolved-location module the location chip and its cascade popover
 * share (openspec `chat-start-location`, design D10).
 *
 * It reads the two routes the create request mirrors — the project's links and
 * `GET /api/v1/projects/:id/start-location` — plus the owner's checkouts and
 * Machine status. Everything the chip renders is derived here, so the chip
 * cannot show a location the create would not resolve: the preview route runs
 * the same resolver as `POST /api/v1/chats`.
 */

export type StartLocationIsolationReason =
  StartLocationResponse["isolationReason"];

/** The isolation and the three ids the create request and the preview share. */
export type { StartLocationIsolation, StartLocationSelection };

/** Why a create's Workspace step failed, as the chip names it. */
export type WorkspaceFailure = {
  status: Exclude<CreationWorkspaceResponseStatus, "bound" | "unbound">;
  executorId?: string;
  message?: string;
};

/** A start the create would refuse or fail; an unchosen level is not one. */
export type LocationWarning = {
  /** `machine` for an unusable Machine, `workspace` for a failed create. */
  step: "machine" | "preview" | "workspace";
  message: string;
};

export const startLocationQueryKeys = {
  all: [...projectQueryKeys.all, "start-location"] as const,
  // Positional ids normalized to null, so `{}` and `{repositoryId: undefined}`
  // are one cache entry (TanStack's serializable-key rule).
  preview: (projectId: string, selection: StartLocationSelection) =>
    [
      ...startLocationQueryKeys.all,
      projectId,
      selection.repositoryId ?? null,
      selection.executorId ?? null,
      selection.checkoutId ?? null,
    ] as const,
};

export async function fetchStartLocation(
  projectId: string,
  selection: StartLocationSelection,
): Promise<StartLocationResponse> {
  const params: GetProjectStartLocationParams = {
    repositoryId: selection.repositoryId,
    executorId: selection.executorId,
    checkoutId: selection.checkoutId,
  };
  return getProjectStartLocation(
    projectId,
    params,
    undefined,
    createAuthenticatedBrowserFetch(globalThis.fetch),
  );
}

/** The preview a create on this project would use; it writes nothing. A new
 *  selection keeps the previous answer on screen until its own arrives, so a
 *  changed level does not blank the row. */
export function useStartLocationPreview(
  projectId: string,
  selection: StartLocationSelection,
  enabled = true,
) {
  return useQuery({
    queryKey: startLocationQueryKeys.preview(projectId, selection),
    queryFn: () => fetchStartLocation(projectId, selection),
    enabled,
    placeholderData: keepPreviousData,
  });
}

/** The Machine an executor id names; the local executor names none. */
export function machineNameFromExecutorId(
  executorId: string,
): string | undefined {
  const prefix = "machine:";
  if (!executorId.startsWith(prefix)) return undefined;
  const name = executorId.slice(prefix.length);
  return name.length === 0 ? undefined : name;
}

export type ExecutorOption = {
  executorId: string;
  label: string;
  /** `main` checkouts of the chosen repository on this executor. */
  mainCheckouts: number;
  /** Why the cascade disables it, or null when it can start a chat. */
  reason: string | null;
};

/** An executor id a failed create proved unusable, with the reason to show. */
export type UnavailableExecutor = {
  executorId: string;
  reason: string;
};

/** An executor id as a reader reads it: the Machine's name, or the id itself. */
export function executorLabel(
  executorId: string,
  machines: ReadonlyArray<MachineResponse> | undefined,
): string {
  const machineName = machineNameFromExecutorId(executorId);
  const machine = findMachineByName(machines, machineName);
  return machine?.name ?? machineName ?? executorId;
}

function executorOption(
  machines: ReadonlyArray<MachineResponse> | undefined,
  executorId: string,
  unavailable: UnavailableExecutor | null,
): Omit<ExecutorOption, "mainCheckouts"> {
  const machineName = machineNameFromExecutorId(executorId);
  const machine = findMachineByName(machines, machineName);
  const label = executorLabel(executorId, machines);
  if (unavailable?.executorId === executorId) {
    return { executorId, label, reason: unavailable.reason };
  }
  if (machineName === undefined) return { executorId, label, reason: null };
  if (machine === undefined) {
    return {
      executorId,
      label,
      reason: "This Machine is not configured.",
    };
  }
  if (machine.status === "online") {
    return { executorId, label, reason: null };
  }
  return {
    executorId,
    label,
    reason:
      machine.failureReason === null
        ? "Offline"
        : `Offline — ${MACHINE_FAILURE_LABELS[machine.failureReason]}`,
  };
}

export type ExecutorOptionsInput = {
  repositoryId: string | null;
  checkouts: ReadonlyArray<CheckoutResponse>;
  machines: ReadonlyArray<MachineResponse> | undefined;
  /** An executor id a failed create proved unusable, with the reason to show. */
  unavailable?: UnavailableExecutor | null;
};

/**
 * The Machine level: every executor that holds a `main` checkout of the chosen
 * repository, with offline Machines disabled and their reason named. Implicit
 * resolution skips those Machines, so the level never offers one as a default
 * it would then refuse.
 */
export function executorOptions(
  input: ExecutorOptionsInput,
): Array<ExecutorOption> {
  if (input.repositoryId === null) return [];
  const counts = new Map<string, number>();
  for (const checkout of input.checkouts) {
    if (checkout.kind !== "main") continue;
    if (checkout.repositoryId !== input.repositoryId) continue;
    counts.set(checkout.executorId, (counts.get(checkout.executorId) ?? 0) + 1);
  }
  return [...counts]
    .map(([executorId, mainCheckouts]) => ({
      ...executorOption(input.machines, executorId, input.unavailable ?? null),
      mainCheckouts,
    }))
    .sort((left, right) => left.label.localeCompare(right.label));
}

/**
 * The isolation label of design D10: the resolved default carries the reason
 * the preview named, and a value the reader changed says so instead.
 */
export function isolationReasonLabel(
  isolation: StartLocationIsolation,
  reason: StartLocationIsolationReason,
  isolationChats: number,
  followsDefault: boolean,
): string {
  if (!followsDefault) return `${isolation} (your choice)`;
  switch (reason) {
    case "project_policy":
      return `${isolation} (project policy)`;
    case "clone_in_use":
      return `${isolation} (clone in use by ${String(isolationChats)} ${
        isolationChats === 1 ? "chat" : "chats"
      })`;
    case "no_link":
      return `${isolation} (no linked repository)`;
  }
}

export type ResolvedLocation = {
  repositoryId: string | null;
  repositoryLabel: string | null;
  /** The catalog's display name, which the worktree placement uses. */
  repositoryName: string | null;
  executor: ExecutorOption | null;
  checkout: CheckoutResponse | null;
  isolation: StartLocationIsolation;
  isolationReason: StartLocationIsolationReason;
  isolationChats: number;
  warning: LocationWarning | null;
};

export type ResolveLocationInput = {
  preview: StartLocationResponse | undefined;
  previewFailed: boolean;
  pending: boolean;
  links: ReadonlyArray<ProjectRepositoryLink>;
  repositories: ReadonlyArray<RepositoryResponse>;
  checkouts: ReadonlyArray<CheckoutResponse>;
  machines: ReadonlyArray<MachineResponse> | undefined;
  failed: WorkspaceFailure | null;
};

const WORKSPACE_FAILURE_FALLBACKS: Record<
  Exclude<CreationWorkspaceResponseStatus, "bound" | "unbound">,
  string
> = {
  bind_failed: "The Workspace could not be bound.",
  worktree_failed: "The worktree could not be created.",
  machine_unavailable: "The Machine is offline.",
  machine_update_required:
    "Update the llame-machine daemon on that Machine to use git operations.",
  outcome_unknown: "The Machine link was lost during the worktree step.",
};

/**
 * The Machine a failed create proved unusable — offline, or a daemon that
 * answers no git method — with the sentence the cascade disables it with.
 */
export function unavailableExecutor(
  failed: WorkspaceFailure | null,
): UnavailableExecutor | null {
  if (failed?.executorId === undefined) return null;
  switch (failed.status) {
    case "machine_unavailable":
      return {
        executorId: failed.executorId,
        reason:
          failed.message ?? WORKSPACE_FAILURE_FALLBACKS.machine_unavailable,
      };
    case "machine_update_required":
      return {
        executorId: failed.executorId,
        reason: WORKSPACE_FAILURE_FALLBACKS.machine_update_required,
      };
    default:
      return null;
  }
}

function workspaceWarning(failed: WorkspaceFailure): LocationWarning {
  const step =
    failed.status === "machine_unavailable" ||
    failed.status === "machine_update_required"
      ? "machine"
      : "workspace";
  return {
    step,
    message:
      failed.message ??
      WORKSPACE_FAILURE_FALLBACKS[failed.status] ??
      "The Workspace could not be prepared.",
  };
}

type RepositoryRows = {
  link: ProjectRepositoryLink | undefined;
  name: string | null;
};

/** The link and catalog row behind a preview's repository id. */
function repositoryRows(input: ResolveLocationInput): RepositoryRows {
  const repositoryId = input.preview?.repositoryId;
  if (repositoryId === null || repositoryId === undefined) {
    return { link: undefined, name: null };
  }
  const link = input.links.find((row) => row.repositoryId === repositoryId);
  const repository = input.repositories.find(
    (row) => row.id === (link?.repositoryId ?? repositoryId),
  );
  return { link, name: repository?.displayName ?? null };
}

/** The executor option the preview names, or null when none resolves. */
function previewExecutor(input: ResolveLocationInput): ExecutorOption | null {
  const executorId = input.preview?.executorId;
  if (executorId === null || executorId === undefined) return null;
  const options = executorOptions({
    repositoryId: input.preview?.repositoryId ?? null,
    checkouts: input.checkouts,
    machines: input.machines,
    unavailable: unavailableExecutor(input.failed),
  });
  return options.find((option) => option.executorId === executorId) ?? null;
}

/**
 * Why the start cannot go ahead: a failed create, a failed preview, or a
 * Machine that cannot serve. A project without a repository, or a repository
 * without a checkout, is an ordinary unbound start, so it warns about nothing.
 */
function locationWarning(
  input: ResolveLocationInput,
  location: ResolvedLocation,
): LocationWarning | null {
  if (input.failed !== null) return workspaceWarning(input.failed);
  if (input.previewFailed) {
    return {
      step: "preview",
      message: "Could not resolve the start location.",
    };
  }
  const executor = location.executor;
  if (executor === null || executor.reason === null) return null;
  return {
    step: "machine",
    message: `${executor.label}: ${executor.reason}`,
  };
}

/**
 * The location the create would use: the preview's ids resolved against the
 * owner's rows, plus the one warning the chip names.
 */
export function resolveLocation(input: ResolveLocationInput): ResolvedLocation {
  const preview = input.preview;
  const { link, name } = repositoryRows(input);
  const executor = previewExecutor(input);
  const checkoutId = preview?.checkoutId ?? null;
  const checkout =
    checkoutId === null
      ? null
      : (input.checkouts.find((row) => row.id === checkoutId) ?? null);
  const location: ResolvedLocation = {
    repositoryId: preview?.repositoryId ?? null,
    repositoryLabel: link?.alias ?? name,
    repositoryName: name,
    executor,
    checkout,
    isolation: preview?.isolation ?? "reuse",
    isolationReason: preview?.isolationReason ?? "no_link",
    isolationChats: preview?.isolationChats ?? 0,
    warning: null,
  };
  return { ...location, warning: locationWarning(input, location) };
}
