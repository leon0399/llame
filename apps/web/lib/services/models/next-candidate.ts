/**
 * The next candidate of a role Run, as the web offers it (model-roles "The
 * next candidate follows the current model in the role", "The web offers the
 * next candidate"). Pure: the same rule the api applies at admission, so the
 * action appears exactly when the api would accept it.
 */

import type {
  ChatLatestRunResponse,
  ModelRoleResponse,
} from "../../api/generated/models";
import { modelDisplayName, type AvailableModel } from "./queries";

/** The candidate a switch would move to. */
export type NextCandidate = {
  modelId: string;
  /** Whether the candidate bills per token; the action marks it. */
  paid: boolean;
};

/** A next candidate with the name the action shows. */
export type NamedNextCandidate = NextCandidate & { name: string };

/** Stable empty sentinel — `?? []` would allocate a new array every render
 *  and defeat memoized transcript rows while the catalog loads. */
export const NO_ROLES: ReadonlyArray<ModelRoleResponse> = [];

/**
 * The candidate after the Run's own model in the role its selector names, or
 * `undefined` when the action cannot apply: an exact selector, an unknown
 * role, a model the role no longer lists, and the last candidate — the chain
 * never wraps.
 */
export function nextCandidateOf(
  run: Pick<ChatLatestRunResponse, "selector" | "modelId">,
  roles: ReadonlyArray<ModelRoleResponse>,
): NextCandidate | undefined {
  const role = roles.find((entry) => entry.selector === run.selector);

  if (role === undefined) return undefined;

  const index = role.candidates.findIndex(
    (candidate) => candidate.modelId === run.modelId,
  );

  if (index === -1) return undefined;

  const next = role.candidates[index + 1];

  if (next === undefined) return undefined;

  return next;
}

/** Whether a latest Run is a turn parked in a quota wait. */
export function isWaitingTurnRun(
  run: ChatLatestRunResponse | null,
): run is ChatLatestRunResponse {
  return run?.kind === "turn" && run.status === "awaiting_quota";
}

/**
 * The next candidate a turn Run parked in a quota wait offers, or
 * `undefined`. A compaction Run never switches (model-roles "A compaction Run
 * does not switch"), and neither does a Run that is not waiting.
 */
export function waitingNextCandidate(
  latestRun: ChatLatestRunResponse | null,
  roles: ReadonlyArray<ModelRoleResponse>,
): NextCandidate | undefined {
  if (!isWaitingTurnRun(latestRun)) {
    return undefined;
  }

  return nextCandidateOf(latestRun, roles);
}

/** The candidate with the catalog name the action shows. */
export function namedNextCandidate(
  candidate: NextCandidate,
  models: ReadonlyArray<AvailableModel>,
): NamedNextCandidate {
  return { ...candidate, name: modelDisplayName(candidate.modelId, models) };
}

/** The action's label: the next model's name, and a paid marker when its
 *  resolved billing is `usage`. */
export function nextCandidateLabel(candidate: NamedNextCandidate): string {
  const paid = candidate.paid ? " (paid)" : "";

  return `Continue on next candidate → ${candidate.name}${paid}`;
}
