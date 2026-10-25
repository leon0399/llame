"use client";

import { useState } from "react";

import type {
  CheckoutResponse,
  MachineResponse,
} from "@/lib/api/generated/models";
import { useCheckoutsQuery } from "@/lib/services/checkouts/queries";
import { useMachinesQuery } from "@/lib/services/machines/queries";
import { useProjectRepositoryLinksQuery } from "@/lib/services/project/queries";
import { useRepositoriesQuery } from "@/lib/services/repositories/queries";
import {
  executorLabel,
  executorOptions,
  isolationReasonLabel,
  resolveLocation,
  unavailableExecutor,
  useStartLocationPreview,
  type ExecutorOption,
  type ResolvedLocation,
  type StartLocationIsolation,
  type StartLocationResponse,
  type StartLocationSelection,
  type WorkspaceFailure,
} from "@/lib/services/project/start-location";
import type { StartLocationPrefill } from "@/lib/services/project/start-location-link";
import type { ProjectRepositoryLink } from "@/lib/services/project/types";
import type { RepositoryResponse } from "@/lib/services/repositories/queries";

/** One registered `main` checkout the composer can start a chat in. */
export type WorkingDirectoryOption = {
  checkoutId: string;
  path: string;
  /** The Machine (or local executor) that holds it. */
  machine: string;
  /** The project links its repository, so it is offered first. */
  linked: boolean;
};

/** The selection the composer holds; `undefined` means "let the server
 *  resolve it", which is what the common case sends. */
type SelectionDraft = StartLocationSelection & {
  /** The reader removed the working directory: the chat starts unbound. */
  cleared: boolean;
  isolation: StartLocationIsolation | null;
};

/** The levels and the labels the location row renders. */
type ComposerLocationView = {
  workingDirectories: Array<WorkingDirectoryOption>;
  machineOptions: Array<ExecutorOption>;
  location: ResolvedLocation;
  isolation: StartLocationIsolation;
  isolationLabel: string;
  followsDefault: boolean;
};

type ComposerLocationActions = {
  selectWorkingDirectory: (checkout: CheckoutResponse) => void;
  clearWorkingDirectory: () => void;
  selectExecutor: (executorId: string) => void;
  selectIsolation: (isolation: StartLocationIsolation) => void;
};

/** Everything the location row reads; the hook is its only producer. */
export type ComposerLocation = ComposerLocationView &
  ComposerLocationActions & {
    /** The owner's checkouts, for matching a typed path to a registered one. */
    checkouts: ReadonlyArray<CheckoutResponse>;
    preview: { pending: boolean; failed: boolean; refetch: () => void };
  };

type PreviewState = {
  data: StartLocationResponse | undefined;
  isPending: boolean;
  isError: boolean;
};

type DeriveLocationViewInput = {
  draft: SelectionDraft;
  preview: PreviewState;
  links: ReadonlyArray<ProjectRepositoryLink>;
  repositories: ReadonlyArray<RepositoryResponse>;
  checkouts: ReadonlyArray<CheckoutResponse>;
  machines: ReadonlyArray<MachineResponse> | undefined;
  failed: WorkspaceFailure | null;
};

/**
 * The effective isolation: the reader's override, else the preview's default;
 * the label names the preview's reason only while the value still follows it.
 */
function isolationView(
  draft: SelectionDraft,
  location: ResolvedLocation,
): Pick<
  ComposerLocationView,
  "isolation" | "isolationLabel" | "followsDefault"
> {
  const isolation = draft.isolation ?? location.isolation;
  const followsDefault =
    draft.isolation === null || draft.isolation === location.isolation;
  return {
    isolation,
    followsDefault,
    isolationLabel: isolationReasonLabel(
      isolation,
      location.isolationReason,
      location.isolationChats,
      followsDefault,
    ),
  };
}

/** Every registered `main` checkout, the project's own repositories first. */
function workingDirectoriesOf(
  input: DeriveLocationViewInput,
): Array<WorkingDirectoryOption> {
  const linked = new Set(input.links.map((link) => link.repositoryId));
  return input.checkouts
    .filter((checkout) => checkout.kind === "main")
    .map((checkout) => ({
      checkoutId: checkout.id,
      path: checkout.path,
      machine: executorLabel(checkout.executorId, input.machines),
      linked: linked.has(checkout.repositoryId),
    }))
    .sort(
      (left, right) =>
        Number(right.linked) - Number(left.linked) ||
        left.machine.localeCompare(right.machine) ||
        left.path.localeCompare(right.path),
    );
}

/** The whole view, from the reads the hook performs; pure so it is unit-tested
 *  without a renderer (the resolved-location module owns the rules). */
function deriveLocationView(
  input: DeriveLocationViewInput,
): ComposerLocationView {
  const { draft, preview } = input;
  const location = resolveLocation({
    preview: preview.data,
    previewFailed: preview.isError,
    pending: preview.isPending,
    links: input.links,
    repositories: input.repositories,
    checkouts: input.checkouts,
    machines: input.machines,
    failed: input.failed,
  });
  const isolation = isolationView(draft, location);
  return {
    workingDirectories: workingDirectoriesOf(input),
    machineOptions: executorOptions({
      repositoryId: location.repositoryId,
      checkouts: input.checkouts,
      machines: input.machines,
      unavailable: unavailableExecutor(input.failed),
    }),
    location,
    ...isolation,
  };
}

/**
 * The location a create without a project would use. No project means no
 * links and no policy, so the named checkout (or a repository's only `main`
 * checkout on the named Machine) is the whole answer, and isolation follows
 * the reader.
 */
function localPreview(
  draft: SelectionDraft,
  checkouts: ReadonlyArray<CheckoutResponse>,
): StartLocationResponse {
  const mains = checkouts.filter(
    (row) =>
      row.kind === "main" &&
      row.repositoryId === draft.repositoryId &&
      row.executorId === draft.executorId,
  );
  const row = draft.cleared
    ? undefined
    : draft.checkoutId === undefined
      ? mains.length === 1
        ? mains[0]
        : undefined
      : checkouts.find((checkout) => checkout.id === draft.checkoutId);
  return {
    projectId: "",
    repositoryId: row?.repositoryId ?? null,
    executorId: row?.executorId ?? null,
    checkoutId: row?.id ?? null,
    isolation: "reuse",
    isolationReason: "no_link",
    isolationChats: 0,
  };
}

/**
 * The composer's selection state. A Machine choice drops the checkout, and
 * any choice clears the isolation override so the new default applies (design
 * D10). `initial` is the entry point's pre-fill, read once.
 */
function initialDraft(
  initial: StartLocationPrefill | null | undefined,
): SelectionDraft {
  return {
    ...initial?.selection,
    cleared: false,
    isolation: initial?.isolation ?? null,
  };
}

type DraftUpdate = (
  change: (current: SelectionDraft) => SelectionDraft,
) => void;

/** The level setters over one draft update. */
function draftActions(update: DraftUpdate): ComposerLocationActions {
  return {
    selectWorkingDirectory: (checkout: CheckoutResponse) =>
      update((current) => ({
        ...current,
        repositoryId: checkout.repositoryId,
        executorId: checkout.executorId,
        checkoutId: checkout.id,
        cleared: false,
        isolation: null,
      })),
    clearWorkingDirectory: () =>
      update((current) => ({
        ...current,
        repositoryId: undefined,
        executorId: undefined,
        checkoutId: undefined,
        cleared: true,
        isolation: null,
      })),
    selectExecutor: (executorId: string) =>
      update((current) => ({
        ...current,
        executorId,
        checkoutId: undefined,
        isolation: null,
      })),
    selectIsolation: (isolation: StartLocationIsolation) =>
      update((current) => ({ ...current, isolation })),
  };
}

function useSelectionDraft(
  projectId: string | null,
  initial: StartLocationPrefill | null | undefined,
  onChange?: () => void,
): ComposerLocationActions & { draft: SelectionDraft } {
  const [state, setState] = useState(() => ({
    projectId,
    draft: initialDraft(initial),
  }));
  // Another project's levels mean nothing here, so a project switch starts
  // from that project's defaults; the pre-fill named the first project only.
  if (state.projectId !== projectId) {
    setState({ projectId, draft: initialDraft(null) });
  }
  const actions = draftActions((change) => {
    setState((current) => ({ ...current, draft: change(current.draft) }));
    onChange?.();
  });
  return { draft: state.draft, ...actions };
}

type ComposerLocationArgs = {
  /** The project whose links and preview are read; null resolves locally. */
  projectId: string | null;
  /** The create's Workspace failure, shown on the row until the draft moves. */
  failed: WorkspaceFailure | null;
  /** Any change to the selection means the reader is correcting the draft. */
  onChange?: () => void;
  /** The entry point's pre-fill: a deep link, or "New chat here". */
  initial?: StartLocationPrefill | null;
  /** False for a chat that already exists: it reads nothing. */
  enabled?: boolean;
};

/**
 * Where the location comes from: a project's preview route, which runs the
 * create's own resolver, or the chosen checkout resolved locally when there
 * is no project. A removed working directory resolves to nothing either way.
 */
function useLocationPreview(
  projectId: string | null,
  draft: SelectionDraft,
  checkouts: ReadonlyArray<CheckoutResponse>,
  enabled: boolean,
): PreviewState & { refetch: () => void } {
  const served = enabled && projectId !== null && !draft.cleared;
  const remote = useStartLocationPreview(projectId ?? "", draft, served);
  const refetch = () => {
    void remote.refetch();
  };
  if (served) return { ...remote, refetch };
  return {
    data: localPreview(draft, checkouts),
    isPending: false,
    isError: false,
    refetch,
  };
}

/** The location row's one source of truth (design D10). */
export function useComposerLocation({
  projectId,
  failed,
  onChange,
  initial,
  enabled = true,
}: ComposerLocationArgs): ComposerLocation {
  const { draft, ...actions } = useSelectionDraft(projectId, initial, onChange);
  const links = useProjectRepositoryLinksQuery(
    projectId ?? "",
    enabled && projectId !== null,
  );
  const repositories = useRepositoriesQuery(enabled);
  const checkouts = useCheckoutsQuery(undefined, enabled).data ?? [];
  const machines = useMachinesQuery();
  const preview = useLocationPreview(projectId, draft, checkouts, enabled);
  return {
    ...deriveLocationView({
      draft,
      preview,
      links: links.data ?? [],
      repositories: repositories.data ?? [],
      checkouts,
      machines: machines.data,
      failed,
    }),
    ...actions,
    checkouts,
    preview: {
      pending: preview.isPending,
      failed: preview.isError,
      refetch: preview.refetch,
    },
  };
}
