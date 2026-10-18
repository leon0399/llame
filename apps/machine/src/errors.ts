import type { MachineErrorCode } from "@workspace/machine-protocol";

/**
 * A refusal the daemon owes the hub as a protocol error rather than as a tool
 * result: a malformed request, an exhausted budget, or an address outside the
 * registered roots. Native tool refusals are results, not these.
 */
export class MachineRequestError extends Error {
  constructor(
    readonly code: MachineErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "MachineRequestError";
  }
}

export function invalidParams(
  method: string,
  detail: string,
): MachineRequestError {
  return new MachineRequestError("invalid_params", `${method}: ${detail}`);
}
