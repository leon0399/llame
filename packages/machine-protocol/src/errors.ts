import type { JsonValue } from "./json-types";

/** Error reasons emitted by the Rust daemon. */
export const MACHINE_ERROR_CODES = [
  "path_not_registered",
  "invalid_argument",
  "machine_job_limit",
  "machine_job_not_found",
  "machine_job_running",
  "budget_exhausted",
  "machine_update_required",
  "machine_capability_missing",
  "machine_identity_mismatch",
  "internal",
] as const;

export type MachineErrorCode = (typeof MACHINE_ERROR_CODES)[number];

export function isMachineErrorCode(value: string): value is MachineErrorCode {
  return MACHINE_ERROR_CODES.some((code) => code === value);
}

/** A refusal translated from gRPC status details or an application outcome. */
export class MachineProtocolError extends Error {
  constructor(
    readonly code: MachineErrorCode,
    message: string,
    readonly data?: JsonValue,
  ) {
    super(message);
    this.name = "MachineProtocolError";
  }
}
