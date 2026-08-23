import { mkdtempSync } from "node:fs";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { SessionLog } from "./session";

function tempLogPath(): string {
  return path.join(
    mkdtempSync(path.join(tmpdir(), "llame-session-")),
    "session.jsonl",
  );
}

describe("SessionLog", () => {
  it("round-trips prompts and assistant messages through deriveMessages", async () => {
    const log = await SessionLog.open(tempLogPath());
    await log.append({ type: "user_prompt", text: "first" });
    await log.append({
      type: "run_event",
      event: {
        type: "run_started",
        receipt: {
          provider: "openai-compatible",
          model: "m",
          systemPrompt: "s",
          advertisedTools: [],
          maxSteps: 8,
        },
      },
    });
    await log.append({
      type: "assistant_messages",
      messages: [{ role: "assistant", content: "answer one" }],
    });
    await log.append({ type: "user_prompt", text: "second" });

    expect(log.deriveMessages()).toEqual([
      { role: "user", content: "first" },
      { role: "assistant", content: "answer one" },
      { role: "user", content: "second" },
    ]);
  });

  it("never projects run events into model context", async () => {
    const log = await SessionLog.open(tempLogPath());
    const entriesBefore = log.all().length;
    await log.append({ type: "user_prompt", text: "q" });
    expect(log.all().length).toBe(entriesBefore + 1);
    // A run event entry is stored for the audit trail…
    await log.append({
      type: "run_event",
      event: { type: "step_cap_reached" },
    });
    expect(log.all().length).toBe(entriesBefore + 2);
    // …but contributes nothing to the projection.
    expect(log.deriveMessages()).toEqual([{ role: "user", content: "q" }]);
  });

  it("reloads a persisted log with continuing sequence numbers", async () => {
    const filePath = tempLogPath();
    const first = await SessionLog.open(filePath);
    await first.append({ type: "user_prompt", text: "one" });

    const reopened = await SessionLog.open(filePath);
    const entry = await reopened.append({ type: "user_prompt", text: "two" });
    expect(entry.seq).toBe(2);
    expect(reopened.deriveMessages()).toEqual([
      { role: "user", content: "one" },
      { role: "user", content: "two" },
    ]);
  });

  it("tolerates a torn trailing line instead of failing the load", async () => {
    const filePath = tempLogPath();
    const log = await SessionLog.open(filePath);
    await log.append({ type: "user_prompt", text: "intact" });
    const raw = await fs.readFile(filePath, "utf8");
    await fs.writeFile(
      filePath,
      `${raw}{"seq":2,"timestamp":"t","event":{"type":"user_pr`,
      "utf8",
    );

    const reopened = await SessionLog.open(filePath);
    expect(reopened.all()).toHaveLength(1);
    const next = await reopened.append({ type: "user_prompt", text: "after" });
    expect(next.seq).toBe(2);
  });

  it("assigns unique seqs to concurrent appends", async () => {
    const log = await SessionLog.open(tempLogPath());
    await Promise.all(
      Array.from({ length: 20 }, () =>
        log.append({ type: "user_prompt", text: "x" }),
      ),
    );
    const seqs = log.all().map((entry) => entry.seq);
    expect(new Set(seqs).size).toBe(20);
  });
});
