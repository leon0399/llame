import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
const checkout = process.argv[2];
if (!checkout) throw new Error("Pass the fast-jev-compaction checkout path.");
const revision = execFileSync("git", ["-C", checkout, "rev-parse", "HEAD"], {
  encoding: "utf8",
}).trim();
assert.equal(revision, "e3f262a7f4d42bd8dd32ced30d26176f7cb545b0");
const { compact } = await import(
  pathToFileURL(resolve(checkout, "src/compact.ts")).href
);
const message = (role, text) => ({ role, text, toolUses: [] });
function transcript(marker) {
  return [
    message("user", "Inspect the deployment and report its outcome."),
    {
      role: "assistant",
      text: "",
      toolUses: [
        {
          tool_use_id: "call_1",
          tool: "deployment_status",
          input: { deployment: "synthetic" },
        },
      ],
    },
    {
      role: "user",
      text: "",
      toolUses: [],
      toolResults: [
        {
          tool_use_id: "call_1",
          text: ("x".repeat(1000) + marker).padEnd(1100, "."),
        },
      ],
    },
    message("assistant", "I will continue checking."),
    message("user", "Continue."),
    message("assistant", "Checking."),
    message("user", "Continue."),
    message("assistant", "Checking."),
    message("user", "Report the deployment outcome."),
    message("assistant", "Preparing the result."),
  ];
}
const states = [];
const asker = {
  ask: async (state, questions) => {
    states.push(state);
    return {
      answers: Object.fromEntries(
        Object.keys(questions).map((k) => [
          k,
          { noul: k.startsWith("call_") ? 0.9 : 0.1 },
        ]),
      ),
    };
  },
};
const original = transcript("OUTCOME_SUCCESS");
const before = JSON.stringify(original);
const first = await compact(original, asker);
await compact(transcript("OUTCOME_FAILURE"), asker);
assert.deepEqual(states[0], states[1]);
assert.equal(JSON.stringify(original), before);
assert.equal(JSON.stringify(first.messages).includes("OUTCOME_SUCCESS"), false);
assert.equal(first.decisions[0].action, "drop_result");
console.log(
  JSON.stringify(
    {
      upstream: "e3f262a7f4d42bd8dd32ced30d26176f7cb545b0",
      networkCalls: 0,
      injectedScores: { keepCall: 0.9, keepResult: 0.1 },
      sameScoringStateForDifferentEqualLengthResults: true,
      originalTranscriptUnchanged: true,
      trailingOutcomeAbsentFromPrunedProjection: true,
      action: first.decisions[0].action,
      stats: first.stats,
      note: "Deterministic mechanics probe; fake scores do not evaluate Jev quality or latency.",
    },
    null,
    2,
  ),
);
