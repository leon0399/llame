import type { VisualResult, VisualResultStatus } from "../shared/results.js";

const STATUS_VALUES = {
  queued: "status-value:pending",
  running: "status-value:pending",
  new: "status-value:new",
  changed: "status-value:modified",
  passed: "status-value:success",
  "capture-error": "status-value:error",
  cancelled: "status-value:unknown",
} as const satisfies Record<VisualResultStatus, string>;

export function statusValueFor(result: VisualResult) {
  return STATUS_VALUES[result.status];
}
