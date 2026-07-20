export type VisualCommand =
  | { type: "get-state" }
  | { type: "run"; scope: "all" | "current"; storyId?: string }
  | { type: "cancel" }
  | {
      type: "approve";
      runId: string;
      storyId: string;
      environmentKey: string;
      candidateSha256: string;
    };

const SHA_256 = /^[a-f0-9]{64}$/;

export function parseCommand(value: unknown): VisualCommand | undefined {
  if (!isRecord(value) || typeof value.type !== "string") return undefined;

  if (value.type === "get-state" || value.type === "cancel") {
    return Object.keys(value).length === 1 ? { type: value.type } : undefined;
  }

  if (value.type === "run") {
    if (value.scope === "all" && Object.keys(value).length === 2) {
      return { type: "run", scope: "all" };
    }

    if (
      value.scope === "current" &&
      typeof value.storyId === "string" &&
      Object.keys(value).length === 3
    ) {
      return { type: "run", scope: "current", storyId: value.storyId };
    }
    return undefined;
  }

  if (
    value.type === "approve" &&
    typeof value.runId === "string" &&
    typeof value.storyId === "string" &&
    typeof value.environmentKey === "string" &&
    typeof value.candidateSha256 === "string" &&
    SHA_256.test(value.candidateSha256) &&
    Object.keys(value).length === 5
  ) {
    return {
      type: "approve",
      runId: value.runId,
      storyId: value.storyId,
      environmentKey: value.environmentKey,
      candidateSha256: value.candidateSha256,
    };
  }

  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
