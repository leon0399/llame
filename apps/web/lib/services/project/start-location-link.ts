import type {
  CheckoutResponse,
  StartLocationResponseIsolation,
} from "../../api/generated/models";

/*
 * The entry points that pre-fill the location chip (openspec
 * `chat-start-location`, design D10). One deep link carries the selection:
 *
 *   /chat/new?project=&repository=&executor=&checkout=&worktree=1
 *
 * The sidebar entries link to it, `/chat/new` forwards a named project to that
 * project's composer, and the composer seeds its chip from the same five
 * parameters. This module is the only place that reads or writes them, so a
 * link and its pre-fill cannot drift apart. It holds no React imports: the
 * `/chat/new` route is a server component.
 */

/** The isolation a pre-filled request asks for. */
export type StartLocationIsolation = StartLocationResponseIsolation;

/** The three ids the create request and the preview route share. */
export type StartLocationSelection = {
  repositoryId?: string;
  executorId?: string;
  checkoutId?: string;
};

/** What an entry point hands the composer before the reader edits anything. */
export type StartLocationPrefill = {
  selection: StartLocationSelection;
  /** `worktree` when the link asked for one; otherwise the preview default. */
  isolation: StartLocationIsolation | null;
};

/** One deep link's parts: the project, the selection, and the isolation ask. */
export type StartLocationDeepLinkInput = StartLocationSelection & {
  projectId?: string;
  /** `true` asks the create for a worktree of the source checkout. */
  worktree?: boolean;
};

/** The three selection ids, in the order the deep link writes them. */
const SELECTION_KEYS = [
  "repositoryId",
  "executorId",
  "checkoutId",
] as const satisfies ReadonlyArray<keyof StartLocationSelection>;

/** The query name each selection id writes. */
const SELECTION_PARAMS: Record<keyof StartLocationSelection, string> = {
  repositoryId: "repository",
  executorId: "executor",
  checkoutId: "checkout",
};

/** A reader-facing parameter, or undefined when absent or blank. */
function paramValue(value: string | null | undefined): string | undefined {
  const trimmed = value?.trim() ?? "";
  return trimmed.length === 0 ? undefined : trimmed;
}

/** The isolation a `worktree` parameter asks for, or null when it is silent. */
function isolationFromParam(
  value: string | null | undefined,
): StartLocationIsolation | null {
  switch (paramValue(value)) {
    case "1":
    case "true":
      return "worktree";
    case "0":
    case "false":
      return "reuse";
    default:
      return null;
  }
}

/** The two halves a deep link carries. */
type DeepLinkParts = {
  projectId: string | undefined;
  prefill: StartLocationPrefill | null;
};

/** The selection, its isolation, and the project a deep link names. */
function deepLinkParts(input: StartLocationDeepLinkInput): DeepLinkParts {
  const selection: StartLocationSelection = {};
  for (const key of SELECTION_KEYS) {
    const value = paramValue(input[key]);
    if (value !== undefined) selection[key] = value;
  }
  const isEmpty = Object.keys(selection).length === 0;
  const isolation = input.worktree === true ? "worktree" : null;
  return {
    projectId: paramValue(input.projectId),
    prefill: isEmpty && isolation === null ? null : { selection, isolation },
  };
}

/** The query string a pre-fill writes, without the leading `?`. */
function prefillQuery(prefill: StartLocationPrefill): string {
  const params = new URLSearchParams();
  for (const key of SELECTION_KEYS) {
    const value = paramValue(prefill.selection[key]);
    if (value !== undefined) params.set(SELECTION_PARAMS[key], value);
  }
  if (prefill.isolation === "worktree") params.set("worktree", "1");
  if (prefill.isolation === "reuse") params.set("worktree", "0");
  return params.toString();
}

/** `/chat/new` with the project and every pre-filled level, or bare `/chat/new`. */
export function startLocationDeepLink(
  input: StartLocationDeepLinkInput = {},
): `/chat/new${string}` {
  const { projectId, prefill } = deepLinkParts(input);
  const params = new URLSearchParams();
  if (projectId !== undefined) params.set("project", projectId);
  const query = prefill === null ? "" : prefillQuery(prefill);
  const all = [params.toString(), query].filter((part) => part.length > 0);
  return all.length === 0 ? "/chat/new" : `/chat/new?${all.join("&")}`;
}

/** A project page URL, with or without a pre-fill query. */
export type ProjectStartHref =
  | `/projects/${string}`
  | `/projects/${string}?${string}`;

/** A project page URL that pre-fills that project's composer. */
export function projectStartPath(
  projectId: string,
  prefill: StartLocationPrefill | null,
): ProjectStartHref {
  const query = prefill === null ? "" : prefillQuery(prefill);
  return `/projects/${encodeURIComponent(projectId)}${
    query.length === 0 ? "" : `?${query}`
  }`;
}

/** The pre-fill a URL carries, or null when it asks for no level. */
export function prefillFromSearchParams(params: {
  get(name: string): string | null | undefined;
}): StartLocationPrefill | null {
  const selection: StartLocationSelection = {};
  for (const key of SELECTION_KEYS) {
    const value = paramValue(params.get(SELECTION_PARAMS[key]));
    if (value !== undefined) selection[key] = value;
  }
  const isolation = isolationFromParam(params.get("worktree"));
  return Object.keys(selection).length === 0 && isolation === null
    ? null
    : { selection, isolation };
}

/**
 * Where `/chat/new` sends a request: a named project's composer with the same
 * pre-fill, or null when no project is named (the caller opens a fresh chat).
 */
export function projectStartRedirect(
  params: Record<string, string | Array<string> | undefined>,
): ProjectStartHref | null {
  const first = params.project;
  const projectId = paramValue(Array.isArray(first) ? first[0] : first);
  if (projectId === undefined) return null;
  return projectStartPath(
    projectId,
    prefillFromSearchParams({
      get: (name) => {
        const value = params[name];
        return Array.isArray(value) ? value[0] : value;
      },
    }),
  );
}

/** The root a bound chat points at, mapped back onto its catalog rows. */
export type StartLocationFromRoot = StartLocationSelection & {
  worktree: boolean;
};

/**
 * "New chat here" copies the source chat's project, repository, executor, and
 * source checkout, and asks for a worktree: the source chat holds the tree, so
 * isolation defaults on (design D10). A root the catalog does not hold still
 * asks for a worktree — the chat is bound to that path whether or not it was
 * registered — and a chat bound to nothing asks for nothing.
 */
export function startLocationFromRoot(
  workspaceRoot: string | null,
  checkouts: ReadonlyArray<CheckoutResponse>,
): StartLocationFromRoot {
  const root = paramValue(workspaceRoot);
  if (root === undefined) return { worktree: false };
  const checkout = checkouts.find((row) => row.path === root);
  if (checkout === undefined) return { worktree: true };
  // A worktree root copies its source `main` clone, because a create names a
  // main checkout as the worktree's source, never the worktree itself.
  const checkoutId =
    checkout.kind === "worktree"
      ? (checkout.parentCheckoutId ?? undefined)
      : checkout.id;
  return {
    repositoryId: checkout.repositoryId,
    executorId: checkout.executorId,
    ...(checkoutId !== undefined && { checkoutId }),
    worktree: true,
  };
}
