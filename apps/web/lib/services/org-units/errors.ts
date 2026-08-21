import {
  getApiErrorInfo,
  getApiErrorStatus,
  isApiError,
} from "../../api/errors";

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readApiError(error: unknown): { message?: string; code?: string } {
  const info = getApiErrorInfo(error);
  if (!isRecord(info)) return {};

  const message = info.message;
  const messageText =
    typeof message === "string"
      ? message
      : Array.isArray(message)
        ? message
            .filter((value): value is string => typeof value === "string")
            .join(" ")
        : undefined;

  return {
    message: messageText || undefined,
    code: typeof info.code === "string" ? info.code : undefined,
  };
}

/**
 * Classify a generated Fetch error from the org-units API into the
 * domain-error vocabulary above. The generated boundary exposes a numeric
 * status and unknown `info`; only structurally recognized fields are read.
 *
 * Status → kind mapping (org-admin-ui spec + design.md D6):
 * - 403 → "forbidden" — never re-implement authorization locally; explain
 *   the missing role instead.
 * - 404 → "not-found" — no existence leak in copy.
 * - 409 → disambiguated by the body's machine-readable `code`
 *   (identity.service.ts's ORG_UNITS_ERROR_CODES: LAST_OWNER /
 *   DUPLICATE_MEMBERSHIP / HAS_CHILDREN / CONCURRENT_TREE_CHANGE). The
 *   feature owns the resulting UI copy; server-provided text is only used for
 *   the documented validation detail.
 * - 422 → move-into-own-subtree validation.
 */
export async function classifyOrgUnitsError(
  error: unknown,
): Promise<OrgUnitsApiError> {
  if (!isApiError(error)) {
    return new OrgUnitsApiError(
      0,
      "unknown",
      "Something went wrong. Please try again.",
    );
  }

  const status = getApiErrorStatus(error);
  if (status === undefined) {
    return new OrgUnitsApiError(
      0,
      "unknown",
      "Something went wrong. Please try again.",
    );
  }

  const { message: apiMessage, code } = readApiError(error);

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
    if (code === "LAST_OWNER") {
      return new OrgUnitsApiError(
        409,
        "last-owner",
        "You’re the last owner here — transfer ownership first. Use the role control next to another member to make them owner, then try again.",
      );
    }
    if (code === "DUPLICATE_MEMBERSHIP") {
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
    "Something went wrong. Please try again.",
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
