export type ApiError = {
  readonly status: number;
  readonly info: unknown;
};

export function isApiError(error: unknown): error is ApiError {
  if (typeof error !== "object" || error === null) {
    return false;
  }

  return (
    "info" in error && "status" in error && typeof error.status === "number"
  );
}

export function getApiErrorStatus(error: unknown): number | undefined {
  return isApiError(error) ? error.status : undefined;
}

// No explicit return type: `ApiError.info` is itself `unknown` (this
// function's whole job is surfacing that unparsed field), and inference
// already produces the same `unknown` result an explicit annotation would.
export function getApiErrorInfo(error: unknown) {
  return isApiError(error) ? error.info : undefined;
}
