import { PermissionModeResponseValue } from "../../api/generated/models";

/** The permission modes this build can send, taken from the generated enum so
 *  a new mode needs no hand edit here. */
export type PermissionMode = PermissionModeResponseValue;

const PERMISSION_MODES: ReadonlySet<unknown> = new Set(
  Object.values(PermissionModeResponseValue),
);

/** Narrows a listed or recorded value to a mode this build can send. */
export function isPermissionMode(value: unknown): value is PermissionMode {
  return PERMISSION_MODES.has(value);
}
