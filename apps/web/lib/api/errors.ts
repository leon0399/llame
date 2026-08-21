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

export function getApiErrorInfo(error: unknown): unknown {
  return isApiError(error) ? error.info : undefined;
}
