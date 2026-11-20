"use client";

import type { ReactElement } from "react";
import { z } from "zod";

import {
  Tool,
  ToolContent,
  ToolHeader,
  ToolOutput,
} from "@workspace/ui/components/ai-elements/tool";
import {
  CodeBlock,
  CodeBlockContent,
} from "@workspace/ui/components/code-block";
import {
  ToolDetails,
  type ToolPartProps,
  ToolResultFallback,
  ToolRow,
  ToolSection,
  ToolText,
} from "@workspace/ui/components/custom/tool-row";

const inputSchema = z.object({
  command: z.string(),
  cwd: z.string().optional(),
  env: z.record(z.string(), z.string()).optional(),
});

const backgroundedOutputSchema = z.looseObject({
  status: z.literal("success"),
  backgrounded: z.literal(true),
  job: z.string(),
  cause: z.enum(["async", "time", "message"]),
  wallTimeMs: z.number().optional(),
});

/** The executor and runner may append their own stream truncation metadata. */
const normalOutputSchema = z.looseObject({
  status: z.literal("success"),
  exitCode: z.number(),
  stdout: z.string(),
  stderr: z.string(),
  cut: z.boolean().optional(),
  truncated: z.boolean().optional(),
  wallTimeMs: z.number().optional(),
  truncationNotice: z.string().optional(),
});

type BackgroundedBashOutput = z.infer<typeof backgroundedOutputSchema>;

type NormalBashOutput = z.infer<typeof normalOutputSchema>;

function BackgroundedResult({ output }: { output: BackgroundedBashOutput }) {
  const cause =
    output.cause === "async"
      ? "Backgrounded by request"
      : output.cause === "time"
        ? "Moved to background after the foreground time limit"
        : "Moved to background for an incoming message";

  const wallTime =
    output.wallTimeMs === undefined
      ? undefined
      : `${(output.wallTimeMs / MILLISECONDS_PER_SECOND).toFixed(1)} s`;

  return (
    <>
      <ToolSection label="Background job">
        <p className="break-all font-mono text-sm">{output.job}</p>
      </ToolSection>
      <ToolDetails
        rows={[
          ["Status", cause],
          ["Time", wallTime],
        ]}
      />
    </>
  );
}

type BashInput = z.infer<typeof inputSchema>;

/** Props for the dedicated `bash` tool row. */
export type BashToolProps = ToolPartProps;

const MILLISECONDS_PER_SECOND = 1000;

/**
 * The terminal: the submitted command as a shell prompt with its standard
 * output beneath it, then standard error in a block of its own.
 */
function Terminal({
  input,
  result,
}: {
  input: BashInput;
  result: NormalBashOutput | undefined;
}) {
  return (
    <>
      <CodeBlock size="sm">
        <CodeBlockContent
          wrap
          className="max-h-64"
          aria-label="Command and standard output"
        >
          <span className="text-muted-foreground">
            <span aria-hidden="true" className="select-none">
              ${" "}
            </span>
            {input.command}
          </span>
          {/* The code is a grid: the output starts its own row. */}
          {result && result.stdout !== "" ? result.stdout : null}
        </CodeBlockContent>
      </CodeBlock>
      {result && result.stderr !== "" ? (
        <ToolText label="Standard error" text={result.stderr} />
      ) : null}
    </>
  );
}

/** The facts of a run the terminal does not show: where, with what, how long. */
function RunDetails({
  input,
  result,
}: {
  input: BashInput;
  result: NormalBashOutput | undefined;
}) {
  const env = Object.entries(input.env ?? {})
    .map(([name, value]) => `${name}=${value}`)
    .join(" ");

  return (
    <ToolDetails
      rows={[
        ["Directory", input.cwd],
        ["Environment", env === "" ? undefined : env],
        ["Exit code", result ? String(result.exitCode) : undefined],
        [
          "Time",
          result?.wallTimeMs === undefined
            ? undefined
            : `${(result.wallTimeMs / MILLISECONDS_PER_SECOND).toFixed(1)} s`,
        ],
        [
          "Truncated",
          result?.cut === true || result?.truncated === true
            ? "yes"
            : undefined,
        ],
        ["Note", result?.truncationNotice],
      ]}
    />
  );
}

/** What a settled command came to, where the call's state does not say. */
function commandOutcome(
  backgrounded: boolean,
  result: NormalBashOutput | undefined,
) {
  if (backgrounded) return { verb: "Backgrounded" };

  return result !== undefined && result.exitCode !== 0
    ? {
        verb: "",
        trailing: `exited with code ${result.exitCode}`,
        failed: true,
      }
    : undefined;
}

/** A call with no result this build reads: its error, unless the reader
 *  stopped it, or its output as it arrived. */
function UnreadOutcome({
  output,
  errorText,
  state,
}: Pick<BashToolProps, "output" | "errorText" | "state">) {
  if (state === "cancelled") return null;

  return errorText ? (
    <ToolOutput errorText={errorText} output={undefined} state="output-error" />
  ) : (
    <ToolOutput output={output} errorText={undefined} />
  );
}

/**
 * Renders a host `bash` invocation as a terminal line: "Running pnpm build",
 * "Ran pnpm build", or "pnpm lint exited with code 1". It opens into the
 * command as a shell prompt with its output, its standard error, and the
 * working directory, added environment, exit code and time of the run, or
 * its background job locator.
 *
 * Follows the shadcn/ui [Terminal](https://ui.shadcn.com/docs/ai-elements/base/terminal)
 * pattern.
 *
 * @summary displays a shell command and its output as a terminal trace line
 */
export function BashTool({
  input,
  output,
  errorText,
  state,
}: BashToolProps): ReactElement {
  const command = inputSchema.safeParse(input).data;
  const backgrounded = backgroundedOutputSchema.safeParse(output).data;
  const result = normalOutputSchema.safeParse(output).data;

  // A call whose arguments are not a command is shown as the generic row.
  if (command === undefined) {
    return (
      <ToolRow name="bash" input={input} errorText={errorText} state={state}>
        <ToolResultFallback output={output} />
      </ToolRow>
    );
  }

  return (
    <Tool>
      <ToolHeader
        type="tool-bash"
        summary={command.command.split("\n")[0]}
        state={state}
        outcome={commandOutcome(backgrounded !== undefined, result)}
      />
      <ToolContent>
        <Terminal input={command} result={result} />
        {backgrounded ? <BackgroundedResult output={backgrounded} /> : null}
        {backgrounded || result ? null : (
          <UnreadOutcome output={output} errorText={errorText} state={state} />
        )}
        <RunDetails input={command} result={result} />
      </ToolContent>
    </Tool>
  );
}
