import { createInterface } from "node:readline/promises";

import {
  type ApprovalDecision,
  type ApprovalGate,
  type ApprovalRequest,
} from "@workspace/harness";

const APPROVAL_RE = /^y(?:es)?$/i;

function describe(request: ApprovalRequest): string {
  const summary = JSON.stringify(request.input);
  const trimmed = summary.length > 300 ? `${summary.slice(0, 300)}…` : summary;
  return `${request.toolId} [${request.classification}] ${trimmed}`;
}

/**
 * Interactive fail-closed approval gate: every non-read-only tool call is
 * shown to the operator as tool + classification + validated input, and
 * only an explicit `y`/`yes` approves. EOF, a closed stdin, a read error,
 * or anything else denies — the harness never executes on silence.
 */
export function createInteractiveApprovalGate(): ApprovalGate {
  return async (request: ApprovalRequest): Promise<ApprovalDecision> => {
    const rl = createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    try {
      const answer = await rl.question(`\napprove? ${describe(request)}\n> `);
      return APPROVAL_RE.test(answer.trim()) ? "approved" : "rejected";
    } catch {
      return "rejected";
    } finally {
      rl.close();
    }
  };
}
