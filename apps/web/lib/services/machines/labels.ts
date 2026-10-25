import type { MachineResponse } from "../../api/generated/models";

/**
 * The five failure reasons the hub records, in the words a reader needs rather
 * than the wire's identifiers. `Record` over the generated union keeps a new
 * reason from compiling without a label. Shared by the settings section and
 * the location chip, which disables an offline Machine with its reason.
 */
export const MACHINE_FAILURE_LABELS: Record<
  NonNullable<MachineResponse["failureReason"]>,
  string
> = {
  unreachable: "Could not be reached",
  host_key_mismatch: "Host key does not match",
  auth_failed: "Authentication failed",
  incompatible_version: "Incompatible protocol version",
  session_lost: "Connection lost",
};
