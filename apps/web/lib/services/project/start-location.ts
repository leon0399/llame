import { useQuery } from "@tanstack/react-query";

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

export type StartLocationIsolation = StartLocationResponse["isolation"];
export type StartLocationIsolationReason =
  StartLocationResponse["isolationReason"];

/** The three ids the create request and the preview route share. */
export type StartLocationSelection = {
  repositoryId?: string;
  executorId?: string;
  checkoutId?: string;
};

/** Why a create's Workspace step failed, as the chip names it. */
export type WorkspaceFailure = {
  status: Exclude<CreationWorkspaceResponseStatus, "bound" | "unbound">;
  executorId?: string;
  message?: string;
};

export type LocationWarning = {
  /** The level the reader has to fix, or `workspace` for a failed create. */
  step: "repository" | "machine" | "checkout" | "preview" | "workspace";
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

/** The preview a create on this project would use; it writes nothing. */
export function useStartLocationPreview(
  projectId: string,
  selection: StartLocationSelection,
  enabled = true,
) {
  return useQuery({
    queryKey: startLocationQueryKeys.preview(projectId, selection),
    queryFn: () => fetchStartLocation(projectId, selection),
    enabled,
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

function executorOption(
  machines: ReadonlyArray<MachineResponse> | undefined,
  executorId: string,
  unavailable: UnavailableExecutor | null,
): Omit<ExecutorOption, "mainCheckouts"> {
  const machineName = machineNameFromExecutorId(executorId);
  const machine = findMachineByName(machines, machineName);
  const label = machine?.name ?? machineName ?? executorId;
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

export type CheckoutOption = {
  id: string;
  path: string;
  branch: string | null;
};

/** The source checkout level: one executor's `main` clones of the repository. */
export function checkoutOptions(
  repositoryId: string | null,
  executorId: string | null,
  checkouts: ReadonlyArray<CheckoutResponse>,
): Array<CheckoutOption> {
  if (repositoryId === null || executorId === null) return [];
  return checkouts.flatMap((checkout) =>
    checkout.kind === "main" &&
    checkout.repositoryId === repositoryId &&
    checkout.executorId === executorId
      ? [{ id: checkout.id, path: checkout.path, branch: checkout.branch }]
      : [],
  );
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

/** No link resolved: say whether the project has none or the reader must pick. */
function repositoryWarning(input: ResolveLocationInput): LocationWarning {
  return {
    step: "repository",
    message:
      input.links.length === 0
        ? "Link a repository to this project."
        : "Choose a repository for this project.",
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

/** The first unresolved or unavailable level, or a failed create's reason. */
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
  if (input.preview === undefined) return null;
  if (location.repositoryId === null) return repositoryWarning(input);
  if (location.executor === null) {
    return {
      step: "machine",
      message: "No Machine holds a checkout of this repository.",
    };
  }
  if (location.executor.reason !== null) {
    return {
      step: "machine",
      message: `${location.executor.label}: ${location.executor.reason}`,
    };
  }
  if (location.checkout === null) {
    return {
      step: "checkout",
      message: `No checkout resolves on ${location.executor.label}.`,
    };
  }
  return null;
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

export type LocationChipSummary = {
  /** The resolved root, one segment per level, joined by the chip. */
  segments: Array<string>;
  /** The isolation's second line (the worktree branch), when isolating. */
  detail: string | null;
  /** The missing level's short name, when the location does not resolve. */
  unresolved: string | null;
};

type LocationChipInput = {
  projectName: string;
  location: ResolvedLocation;
  isolation: StartLocationIsolation;
  worktreeName: string;
  baseRef: string;
  pending: boolean;
  followsDefault: boolean;
  isolationLabel: string;
};

const UNRESOLVED_LABELS: Record<LocationWarning["step"], string | null> = {
  repository: "Choose a repository",
  machine: "Choose a machine",
  checkout: "Choose a checkout",
  preview: "Location unavailable",
  workspace: null,
};

/**
 * The directory `enter_workspace` would create for a named worktree, from the
 * documented placement rule: the source clone's parent (or the checkout's
 * `worktreeBase`), then `.llame-worktrees/<repository display name>/<slug>`.
 * An unnamed worktree gets a server-generated name, so its path is unknown.
 */
function worktreeDirectory(
  checkout: CheckoutResponse,
  repositoryName: string,
  name: string,
): string {
  const index = checkout.path.lastIndexOf("/");
  const parent = index <= 0 ? "/" : checkout.path.slice(0, index);
  const base = checkout.worktreeBase ?? `${parent}/.llame-worktrees`;
  return `${base}/${repositoryName}/${name.replaceAll("/", "-")}`;
}

/** The worktree branch the request would create, or the generated placeholder. */
function worktreeBranch(name: string): string {
  const trimmed = name.trim();
  if (trimmed.length === 0) return "new worktree";
  return trimmed.includes("/") ? trimmed : `llame/${trimmed}`;
}

/** The checkout line: the path, with its branch when the chat reuses it. */
function checkoutSegment(
  checkout: CheckoutResponse,
  isolation: StartLocationIsolation,
): string {
  if (isolation === "worktree" || checkout.branch === null)
    return checkout.path;
  return `${checkout.path} (${checkout.branch})`;
}

/** The worktree form: the directory a named tree lands in, then its branch. */
function worktreeChip(
  input: LocationChipInput,
  location: ResolvedLocation,
  segments: Array<string>,
): LocationChipSummary {
  const checkout = location.checkout;
  if (checkout === null) return { segments, detail: null, unresolved: null };
  const base = input.baseRef.trim() || checkout.branch || "HEAD";
  const name = input.worktreeName.trim();
  const directory =
    name.length > 0 && location.repositoryName !== null
      ? worktreeDirectory(checkout, location.repositoryName, name)
      : null;
  return {
    segments:
      directory === null ? segments : [...segments.slice(0, -1), directory],
    detail: `${worktreeBranch(name)} ← ${base} · ${input.isolationLabel}`,
    unresolved: null,
  };
}

/**
 * What the chip shows. An unnamed worktree gets a server-generated name, so the
 * chip keeps the source checkout and names the branch the create will make.
 */
export function locationChip(input: LocationChipInput): LocationChipSummary {
  const { location } = input;
  const segments = [input.projectName];
  if (location.repositoryLabel !== null)
    segments.push(location.repositoryLabel);
  if (location.executor !== null) segments.push(location.executor.label);
  if (location.checkout !== null) {
    segments.push(checkoutSegment(location.checkout, input.isolation));
  }
  const warning = location.warning;
  if (input.pending) {
    return { segments, detail: "Resolving location…", unresolved: null };
  }
  // A resolved location that still cannot start names the failure (an offline
  // Machine, an outdated daemon, a rejected worktree); an unresolved level
  // names the choice the reader has to make.
  const resolved =
    location.repositoryId !== null &&
    location.executor !== null &&
    location.checkout !== null;
  if (warning !== null && resolved) {
    return { segments, detail: warning.message, unresolved: null };
  }
  if (input.isolation === "worktree" && location.checkout !== null) {
    return worktreeChip(input, location, segments);
  }
  return {
    segments,
    detail: location.checkout === null ? null : input.isolationLabel,
    unresolved:
      warning === null ? null : (UNRESOLVED_LABELS[warning.step] ?? null),
  };
}
