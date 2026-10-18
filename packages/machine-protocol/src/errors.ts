/**
 * The closed set of `error.data.code` values a Machine error carries. The hub
 * branches on `data.code`, never on the JSON-RPC number or the message text.
 */
export const MACHINE_ERROR_CODES = [
  "path_not_registered",
  "budget_exhausted",
  "incompatible_version",
  "invalid_params",
  "internal",
] as const;

export type MachineErrorCode = (typeof MACHINE_ERROR_CODES)[number];

/** JSON-RPC numbers: the standard ones for standard conditions, and one
 *  application number per Machine condition outside JSON-RPC's vocabulary. */
export const JSON_RPC_INVALID_REQUEST = -32_600;
export const JSON_RPC_METHOD_NOT_FOUND = -32_601;
export const JSON_RPC_INVALID_PARAMS = -32_602;
export const JSON_RPC_INTERNAL_ERROR = -32_603;
export const JSON_RPC_PATH_NOT_REGISTERED = -32_001;
export const JSON_RPC_BUDGET_EXHAUSTED = -32_002;
export const JSON_RPC_INCOMPATIBLE_VERSION = -32_003;

/** The one number each Machine code is reported under. */
export const MACHINE_ERROR_JSON_RPC: Readonly<
  Record<MachineErrorCode, number>
> = {
  path_not_registered: JSON_RPC_PATH_NOT_REGISTERED,
  budget_exhausted: JSON_RPC_BUDGET_EXHAUSTED,
  incompatible_version: JSON_RPC_INCOMPATIBLE_VERSION,
  invalid_params: JSON_RPC_INVALID_PARAMS,
  internal: JSON_RPC_INTERNAL_ERROR,
};

export function isMachineErrorCode(value: string): value is MachineErrorCode {
  return MACHINE_ERROR_CODES.some((code) => code === value);
}
