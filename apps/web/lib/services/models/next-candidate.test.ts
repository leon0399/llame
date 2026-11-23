/**
 * The next-candidate rule (model-roles "The next candidate follows the current
 * model in the role", "The web offers the next candidate").
 */

import { describe, expect, it } from "vitest";

import type {
  ChatLatestRunResponse,
  ModelRoleResponse,
} from "@/lib/api/generated/models";
import type { AvailableModel } from "./queries";

import {
  namedNextCandidate,
  nextCandidateLabel,
  nextCandidateOf,
  waitingNextCandidate,
} from "./next-candidate";

const CODEX = "system:openai:codex";
const SONNET = "system:anthropic:sonnet";
const OPUS = "system:anthropic:opus";

const ROLES: ReadonlyArray<ModelRoleResponse> = [
  {
    selector: "@coding",
    candidates: [
      { modelId: CODEX, paid: false },
      { modelId: SONNET, paid: true },
      { modelId: OPUS, paid: false },
    ],
  },
  { selector: "@fast", candidates: [{ modelId: CODEX, paid: false }] },
];

const MODELS: ReadonlyArray<AvailableModel> = [
  {
    id: SONNET,
    source: "system",
    name: "Claude Sonnet",
    contextWindowTokens: 400_000,
    input: ["text"],
  },
];

function run(
  overrides: Partial<ChatLatestRunResponse> = {},
): ChatLatestRunResponse {
  return {
    kind: "turn",
    id: "11111111-1111-4111-8111-111111111111",
    messageId: "user-turn",
    status: "failed",
    followUpAction: null,
    selector: "@coding",
    modelId: CODEX,
    effort: null,
    permissionMode: "default",
    error: null,
    errorCode: null,
    errorResetsAt: null,
    quotaWait: null,
    ...overrides,
  };
}

describe("nextCandidateOf", () => {
  it("takes the candidate after the Run's own model in its role", () => {
    expect(nextCandidateOf(run(), ROLES)).toEqual({
      modelId: SONNET,
      paid: true,
    });
  });

  it("follows the chain rather than the role's first candidate", () => {
    expect(nextCandidateOf(run({ modelId: SONNET }), ROLES)).toEqual({
      modelId: OPUS,
      paid: false,
    });
  });

  it("never wraps: the last candidate has no next one", () => {
    expect(nextCandidateOf(run({ modelId: OPUS }), ROLES)).toBeUndefined();
  });

  it("refuses an exact selector", () => {
    expect(nextCandidateOf(run({ selector: CODEX }), ROLES)).toBeUndefined();
  });

  it("refuses an unknown role", () => {
    expect(
      nextCandidateOf(run({ selector: "@unlisted" }), ROLES),
    ).toBeUndefined();
  });

  it("refuses a model the role no longer lists", () => {
    expect(
      nextCandidateOf(run({ modelId: "system:openai:removed" }), ROLES),
    ).toBeUndefined();
  });

  it("refuses a Run of another role's candidate", () => {
    // `@fast` lists only `codex`, so a `sonnet` Run of it has no position.
    expect(
      nextCandidateOf(run({ selector: "@fast", modelId: SONNET }), ROLES),
    ).toBeUndefined();
  });

  it("refuses a missing Run", () => {
    expect(nextCandidateOf(null, ROLES)).toBeUndefined();
  });
});

describe("waitingNextCandidate", () => {
  it("offers the next candidate of a turn Run in a quota wait", () => {
    expect(
      waitingNextCandidate(run({ status: "awaiting_quota" }), ROLES),
    ).toEqual({ modelId: SONNET, paid: true });
  });

  it("offers nothing for a Run that is not waiting", () => {
    expect(waitingNextCandidate(run(), ROLES)).toBeUndefined();
  });

  it("offers nothing for a compaction Run in a quota wait", () => {
    expect(
      waitingNextCandidate(
        run({ kind: "compaction", messageId: null, status: "awaiting_quota" }),
        ROLES,
      ),
    ).toBeUndefined();
  });

  it("offers nothing without a Run", () => {
    expect(waitingNextCandidate(null, ROLES)).toBeUndefined();
  });
});

describe("the action's label", () => {
  it("names the model and marks a paid candidate", () => {
    const named = namedNextCandidate({ modelId: SONNET, paid: true }, MODELS);

    expect(nextCandidateLabel(named)).toBe(
      "Continue on next candidate → Claude Sonnet (paid)",
    );
  });

  it("falls back to the model id and labels an unpaid candidate plainly", () => {
    const named = namedNextCandidate({ modelId: CODEX, paid: false }, MODELS);

    expect(nextCandidateLabel(named)).toBe(
      `Continue on next candidate → ${CODEX}`,
    );
  });
});
