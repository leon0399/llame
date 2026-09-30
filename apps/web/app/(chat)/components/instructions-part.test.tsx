/**
 * Pure `parseInstructionsPart` shape handling only — the chip's rendered
 * state lives in instructions-part.stories.tsx (docs/testing.md rule 5). The
 * strict part narrowing it delegates to is covered against its sibling
 * `data-context` producers in lib/services/chat/history.test.ts.
 */

import { describe, expect, it } from "vitest";

import { parseInstructionsPart } from "./instructions-part";

const INSTRUCTIONS_PAYLOAD = {
  files: [
    {
      path: "/home/u/repo/apps/api/AGENTS.md",
      canonicalPath: "/home/u/repo/AGENTS.md",
      truncated: true,
    },
  ],
  denied: ["/srv/AGENTS.md"],
};

const INSTRUCTIONS_PART = {
  type: "data-context",
  data: {
    v: 1,
    producer: "instructions",
    form: "notice",
    runId: "a5dc235e-1de8-4aad-84d8-e0e247b6a135",
    payload: INSTRUCTIONS_PAYLOAD,
    text: "loaded 1 instruction file",
  },
};

describe("parseInstructionsPart", () => {
  it("reads the payload the chip renders, paths and flags intact", () => {
    expect(parseInstructionsPart(INSTRUCTIONS_PART)).toEqual(
      INSTRUCTIONS_PAYLOAD,
    );
  });

  it("returns null for another producer's data-context item", () => {
    expect(
      parseInstructionsPart({
        ...INSTRUCTIONS_PART,
        data: { ...INSTRUCTIONS_PART.data, producer: "temporal" },
      }),
    ).toBeNull();
  });

  it("returns null rather than rendering a chip from a payload it cannot trust", () => {
    expect(
      parseInstructionsPart({
        ...INSTRUCTIONS_PART,
        data: {
          ...INSTRUCTIONS_PART.data,
          payload: {
            files: [{ path: "/srv/AGENTS.md", truncated: false }],
            denied: [],
          },
        },
      }),
    ).toBeNull();
    expect(parseInstructionsPart(null)).toBeNull();
    expect(parseInstructionsPart({ type: "text", text: "hello" })).toBeNull();
  });
});
