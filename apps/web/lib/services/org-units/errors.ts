import { HTTPError } from "ky";

/**
 * org-admin-ui spec's domain-error vocabulary (D6 / spec "Domain error
 * semantics in UX copy"): the UI must map specific API conflicts to specific,
 * actionable copy, not a generic "something went wrong".
 */
export type OrgUnitsErrorKind =
  | "forbidden"
  | "not-found"
  | "duplicate-membership"
  | "last-owner"
  | "concurrent-change"
  | "validation"
  | "unknown";

export class OrgUnitsApiError extends Error {
  readonly status: number;
  readonly kind: OrgUnitsErrorKind;

  constructor(status: number, kind: OrgUnitsErrorKind, message: string) {
    super(message);
    this.name = "OrgUnitsApiError";
    this.status = status;
    this.kind = kind;
  }
}

async function readApiError(
  error: HTTPError,
): Promise<{ message?: string; code?: string }> {
  try {
    const body = (await error.response.json()) as {
      message?: string | string[];
      code?: string;
    };
    return {
      message: Array.isArray(body.message)
        ? body.message.join(" ")
        : body.message,
      code: body.code,
    };
  } catch {
    return {};
  }
}

/**
 * Classify a ky `HTTPError` from the org-units API into the domain-error
 * vocabulary above. Reads the response body ONCE and returns a plain `Error`
 * subclass with a synchronously-readable `.kind`/`.message` — ky's
 * `HTTPError` body is otherwise only readable asynchronously, which is
 * awkward to consume from a mutation's (synchronous) `onError`.
 *
 * Status → kind mapping (org-admin-ui spec + design.md D6):
 * - 403 → "forbidden" — never re-implement authorization locally; explain
 *   the missing role instead.
 * - 404 → "not-found" — no existence leak in copy.
 * - 409 → disambiguated by the body's machine-readable `code`
 *   (identity.service.ts's ORG_UNITS_ERROR_CODES: LAST_OWNER /
 *   DUPLICATE_MEMBERSHIP / HAS_CHILDREN / CONCURRENT_TREE_CHANGE), with the
 *   pre-`code` message-text regexes kept only as a fallback for older API
 *   builds — a copy edit server-side must never downgrade "transfer
 *   ownership first" into generic retry guidance.
 * - 422 → move-into-own-subtree validation.
 */
export async function classifyOrgUnitsError(
  error: unknown,
): Promise<OrgUnitsApiError> {
  if (!(error instanceof HTTPError)) {
    return new OrgUnitsApiError(
      0,
      "unknown",
      "Something went wrong. Please try again.",
    );
  }

  const status = error.response.status;
  const { message: apiMessage, code } = await readApiError(error);

  if (status === 403) {
    return new OrgUnitsApiError(
      403,
      "forbidden",
      "You need admin or owner access on this unit (or an ancestor) to do that.",
    );
  }
  if (status === 404) {
    return new OrgUnitsApiError(404, "not-found", "Not found.");
  }
  if (status === 409) {
    if (
      code === "LAST_OWNER" ||
      (!code && apiMessage && /transfer ownership/i.test(apiMessage))
    ) {
      return new OrgUnitsApiError(
        409,
        "last-owner",
        "You’re the last owner here — transfer ownership first. Use the role control next to another member to make them owner, then try again.",
      );
    }
    if (
      code === "DUPLICATE_MEMBERSHIP" ||
      (!code && apiMessage && /already a member/i.test(apiMessage))
    ) {
      return new OrgUnitsApiError(
        409,
        "duplicate-membership",
        "Already a member.",
      );
    }
    // Not a race: the unit genuinely has children — retrying can't succeed.
    if (code === "HAS_CHILDREN") {
      return new OrgUnitsApiError(
        409,
        "validation",
        apiMessage ?? "This unit has child units — delete them first.",
      );
    }
    return new OrgUnitsApiError(
      409,
      "concurrent-change",
      "The tree changed — refreshed, try again.",
    );
  }
  if (status === 422) {
    return new OrgUnitsApiError(
      422,
      "validation",
      apiMessage ?? "That move isn’t allowed.",
    );
  }
  return new OrgUnitsApiError(
    status,
    "unknown",
    apiMessage ?? "Something went wrong. Please try again.",
  );
}

/** Wrap an org-units API call so failures reject with a classified `OrgUnitsApiError`. */
export async function withOrgUnitsErrors<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    throw await classifyOrgUnitsError(error);
  }
}
