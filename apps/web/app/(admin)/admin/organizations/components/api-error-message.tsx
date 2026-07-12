import { OrgUnitsApiError } from "@/lib/services/org-units/errors";

/**
 * Inline domain-error copy (org-admin-ui spec "Domain error semantics in UX
 * copy"): every org-units mutation classifies its failure into an
 * `OrgUnitsApiError` (see lib/services/org-units/errors.ts) with a
 * spec-specific message — this just renders it next to the control that
 * failed, not only as a toast.
 */
export function ApiErrorMessage({ error }: { error: unknown }) {
  if (!error) return null;
  const message =
    error instanceof OrgUnitsApiError
      ? error.message
      : "Something went wrong. Please try again.";
  return <p className="text-sm text-destructive">{message}</p>;
}
