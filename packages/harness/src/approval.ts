import { type ToolClassification } from "./tools/types";
import { type UnknownRecord } from "./unknown-record";

/**
 * What the gate is asked to decide. `input` is the model-supplied argument
 * record, already schema-validated — it exists so a human (or policy) can
 * judge the actual operation, not just the tool name.
 */
export interface ApprovalRequest {
  readonly toolId: string;
  readonly classification: ToolClassification;
  readonly input: UnknownRecord;
}

export type ApprovalDecision = "approved" | "rejected";

/**
 * The single approval seam in front of every non-read-only tool. Fail-closed
 * contract, enforced by the runner: an absent gate, a thrown gate, and any
 * answer other than `'approved'` all deny. Fine-grained per-tool grants and
 * named policy presets are later work; this is the minimal boundary that
 * lets a write-capable local harness ship without shipping silent writes.
 */
export type ApprovalGate = (
  request: ApprovalRequest,
) => Promise<ApprovalDecision>;
