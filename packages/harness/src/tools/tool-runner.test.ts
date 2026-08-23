import { z } from "zod";

import { RESULT_TRUNCATE_CHARS } from "./result-truncation";
import { runTool } from "./tool-runner";
import type { Tool } from "./types";
import type { UnknownRecord } from "../unknown-record";

interface CliToolContext {
  readonly abortSignal?: AbortSignal;
  readonly toolCallId?: string;
}

const echoTool: Tool<{ value: string }, CliToolContext> = {
  id: "echo",
  description: "echoes the input",
  classification: "read_only",
  inputSchema: z.object({ value: z.string() }).strict(),
  execute: (_ctx, { value }) => ({ status: "success", value }),
};

describe("runTool", () => {
  it("fails closed when no trusted context is supplied (D4)", async () => {
    const spy = vi.fn();
    const spyingTool: Tool<{ value: string }, CliToolContext> = {
      ...echoTool,
      execute: (ctx, args) => {
        spy();
        return echoTool.execute(ctx, args);
      },
    };
    const result = await runTool(spyingTool, { value: "x" }, undefined, 15);
    expect(result).toMatchObject({ status: "error", type: "no_context" });
    expect(spy).not.toHaveBeenCalled();
  });

  it("validates input against the tool schema before executing", async () => {
    const result = await runTool(echoTool, { value: 123 }, {}, 15);
    expect(result).toMatchObject({ status: "error", type: "invalid_input" });
  });

  it("executes and returns the structured result on valid input", async () => {
    const result = await runTool(echoTool, { value: "hi" }, {}, 15);
    expect(result).toEqual({ status: "success", value: "hi" });
  });

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY, 15.001])(
    "defensively refuses an invalid trusted timeout override of %s",
    async (timeoutSeconds) => {
      const execute = vi.fn(() => ({ status: "success" as const }));

      const result = await runTool(
        { ...echoTool, timeoutSeconds, execute },
        { value: "hi" },
        {},
        15,
      );

      expect(result).toEqual({
        status: "error",
        type: "not_available",
        message: 'Tool "echo" is not available.',
      });
      expect(execute).not.toHaveBeenCalled();
    },
  );

  it("fires onValidated once input validation passes, before executing", async () => {
    const onValidated = vi.fn();
    await runTool(echoTool, { value: "hi" }, {}, 15, onValidated);
    expect(onValidated).toHaveBeenCalledTimes(1);
  });

  it("never fires onValidated when input validation fails", async () => {
    const onValidated = vi.fn();
    await runTool(echoTool, { value: 123 }, {}, 15, onValidated);
    expect(onValidated).not.toHaveBeenCalled();
  });

  it("refuses a trusted timeout that AbortSignal cannot represent", async () => {
    const execute = vi.fn(() => ({ status: "success" as const }));
    const result = await runTool(
      { ...echoTool, timeoutSeconds: 0.0001, execute },
      { value: "x" },
      {},
      15,
    );

    expect(result).toEqual({
      status: "error",
      type: "not_available",
      message: 'Tool "echo" is not available.',
    });
    expect(execute).not.toHaveBeenCalled();
  });

  it("turns a thrown error into a structured, non-leaking error result", async () => {
    const throwingTool: Tool<{ value: string }, CliToolContext> = {
      ...echoTool,
      execute: () => {
        throw new Error("secret internal detail: db://user:pass@host");
      },
    };
    const result = await runTool(throwingTool, { value: "x" }, {}, 15);
    expect(result).toMatchObject({ status: "error", type: "execution_failed" });
    expect(JSON.stringify(result)).not.toContain("secret internal detail");
  });

  it("classifies a cooperative rejection caused by the per-call timeout as timeout", async () => {
    let executionSignal: AbortSignal | undefined;
    const cooperativeTool: Tool<{ value: string }, CliToolContext> = {
      ...echoTool,
      timeoutSeconds: 0.01,
      execute: ({ abortSignal }) => {
        executionSignal = abortSignal;
        return new Promise((_resolve, reject) => {
          abortSignal?.addEventListener(
            "abort",
            () => reject(new Error("cooperative timeout abort")),
            { once: true },
          );
        });
      },
    };

    const result = await runTool(cooperativeTool, { value: "x" }, {}, 15);

    expect(executionSignal?.aborted).toBe(true);
    expect(result).toMatchObject({ status: "error", type: "timeout" });
  });

  it("classifies a parent run abort as cancelled", async () => {
    const abort = new AbortController();
    let executionStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      executionStarted = resolve;
    });
    let executionSignal: AbortSignal | undefined;
    const cooperativeTool: Tool<{ value: string }, CliToolContext> = {
      ...echoTool,
      execute: ({ abortSignal }) => {
        executionSignal = abortSignal;
        executionStarted();
        return new Promise((_resolve, reject) => {
          abortSignal?.addEventListener(
            "abort",
            () => reject(new Error("cooperative parent abort")),
            { once: true },
          );
        });
      },
    };

    const resultPromise = runTool(
      cooperativeTool,
      { value: "x" },
      { abortSignal: abort.signal },
      15,
    );
    await started;
    abort.abort();
    const result = await resultPromise;

    expect(executionSignal).not.toBe(abort.signal);
    expect(executionSignal?.aborted).toBe(true);
    expect(result).toMatchObject({ status: "error", type: "cancelled" });
    expect(result).not.toMatchObject({ type: "execution_failed" });
  });

  it("does not validate or execute a tool when the parent run is already aborted", async () => {
    const abort = new AbortController();
    abort.abort();
    const execute = vi.fn(() => ({ status: "success" as const }));
    const onValidated = vi.fn();
    const timeoutSpy = vi.spyOn(AbortSignal, "timeout");

    const result = await runTool(
      { ...echoTool, execute },
      { value: 123 },
      { abortSignal: abort.signal },
      15,
      onValidated,
    );

    expect(result).toMatchObject({ status: "error", type: "cancelled" });
    expect(execute).not.toHaveBeenCalled();
    expect(onValidated).not.toHaveBeenCalled();
    expect(timeoutSpy).not.toHaveBeenCalled();
  });

  it("uses one shared timeout signal and bounds a tool that ignores it", async () => {
    const timeoutSpy = vi.spyOn(AbortSignal, "timeout");
    let executionSignal: AbortSignal | undefined;
    const hangingTool: Tool<{ value: string }, CliToolContext> = {
      ...echoTool,
      timeoutSeconds: 0.05,
      execute: ({ abortSignal }) => {
        executionSignal = abortSignal;
        return new Promise(() => {});
      },
    };
    const startedAt = Date.now();
    const result = await runTool(hangingTool, { value: "x" }, {}, 15);

    expect(timeoutSpy).toHaveBeenCalledTimes(1);
    expect(executionSignal).toBe(timeoutSpy.mock.results[0]?.value);
    expect(executionSignal?.aborted).toBe(true);
    expect(Date.now() - startedAt).toBeLessThan(1_000);
    expect(result).toMatchObject({ status: "error", type: "timeout" });
  });

  it("truncates an oversized result with a visible marker", async () => {
    const bigTool: Tool<{ value: string }, CliToolContext> = {
      ...echoTool,
      execute: () => ({ status: "success", blob: "x".repeat(20_000) }),
    };
    const result = await runTool(bigTool, { value: "x" }, {}, 15);
    expect(result).toMatchObject({ status: "success", truncated: true });
    expect(JSON.stringify(result).length).toBeLessThanOrEqual(
      RESULT_TRUNCATE_CHARS,
    );
    // SAFETY: toMatchObject only asserts at runtime; `blob` is the tool's own
    // passthrough field (#294) whose shape preservation lives in
    // result-truncation.test.ts — this pins the runner wiring only.
    expect((result as UnknownRecord).blob).toEqual(expect.any(String));
  });

  it("fails closed when truncation receives a malformed oversized projection", async () => {
    const malformedTool: Tool<{ value: string }, CliToolContext> = {
      ...echoTool,
      // SAFETY: the returned object deliberately carries a hostile toJSON to
      // exercise truncation's malformed-projection path; it is handed to the
      // runner as an opaque ToolResult exactly as a broken tool would.
      execute: () => ({
        status: "success",
        toJSON: () =>
          Array.from({ length: RESULT_TRUNCATE_CHARS }, () => "malformed"),
      }),
    };

    const result = await runTool(malformedTool, { value: "x" }, {}, 15);

    expect(result).toEqual({
      status: "error",
      type: "execution_failed",
      message: "The tool failed to execute.",
    });
  });

  function resultPaddedToJsonLength(
    targetLength: number,
  ): Tool<{ value: string }, CliToolContext> {
    const overhead = JSON.stringify({ status: "success", value: "" }).length;
    const value = "x".repeat(targetLength - overhead);
    return { ...echoTool, execute: () => ({ status: "success", value }) };
  }

  it("does not truncate a result whose JSON is exactly RESULT_TRUNCATE_CHARS", async () => {
    const tool = resultPaddedToJsonLength(RESULT_TRUNCATE_CHARS);
    const result = await runTool(tool, { value: "x" }, {}, 15);
    expect(JSON.stringify(result).length).toBe(RESULT_TRUNCATE_CHARS);
    expect(result).not.toMatchObject({ truncated: true });
  });

  it("truncates a result whose JSON is RESULT_TRUNCATE_CHARS + 1", async () => {
    const tool = resultPaddedToJsonLength(RESULT_TRUNCATE_CHARS + 1);
    const result = await runTool(tool, { value: "x" }, {}, 15);
    expect(result).toMatchObject({ status: "success", truncated: true });
  });
});
