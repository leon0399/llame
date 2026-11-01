"use client";

import type { ReactElement } from "react";
import { z } from "zod";

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

/** Loose: the runner's oversize cap may add `truncated`/`truncationNotice`,
 *  the executor's own stream cut is `cut`, and a part stored before either
 *  carries `truncated` for the executor cut and may hold the old
 *  `operation`/`executor`. */
const outputSchema = z.looseObject({
  status: z.literal("success"),
  exitCode: z.number(),
  stdout: z.string(),
  stderr: z.string(),
  cut: z.boolean().optional(),
  truncated: z.boolean().optional(),
  wallTimeMs: z.number().optional(),
  truncationNotice: z.string().optional(),
});

type BashInput = z.infer<typeof inputSchema>;
type BashOutput = z.infer<typeof outputSchema>;

/** Props for the dedicated `bash` tool row. */
export type BashToolProps = ToolPartProps;

/** The submitted command as a shell prompt, with its working directory and
 *  added environment beneath it. */
function BashCommand({ input }: { input: BashInput }) {
  const env = Object.entries(input.env ?? {});
  return (
    <ToolSection label="Command">
      <div className="space-y-1 rounded-md bg-muted/50 p-3 font-mono text-xs">
        <p className="whitespace-pre-wrap break-words">
          <span
            aria-hidden="true"
            className="select-none text-muted-foreground"
          >
            ${" "}
          </span>
          {input.command}
        </p>
        {input.cwd ? (
          <p className="break-all text-muted-foreground">in {input.cwd}</p>
        ) : null}
        {env.map(([name, value]) => (
          <p className="break-all text-muted-foreground" key={name}>
            env {name}={value}
          </p>
        ))}
      </div>
    </ToolSection>
  );
}

const MILLISECONDS_PER_SECOND = 1000;

function BashResult({ output }: { output: BashOutput }) {
  const wallTime =
    output.wallTimeMs === undefined
      ? undefined
      : `${(output.wallTimeMs / MILLISECONDS_PER_SECOND).toFixed(1)} s`;
  return (
    <>
      <ToolSection label="Output" aside={`exit ${output.exitCode}`}>
        {output.stdout === "" && output.stderr === "" ? (
          <p className="text-muted-foreground text-sm">No output.</p>
        ) : null}
        {output.stdout === "" ? null : (
          <ToolText label="Standard output" text={output.stdout} />
        )}
        {output.stderr === "" ? null : (
          <div className="space-y-1">
            <p className="text-muted-foreground text-xs">stderr</p>
            <ToolText label="Standard error" text={output.stderr} />
          </div>
        )}
      </ToolSection>
      <ToolDetails
        rows={[
          ["Time", wallTime],
          [
            "Truncated",
            output.cut === true || output.truncated === true
              ? "yes"
              : undefined,
          ],
          ["Note", output.truncationNotice],
        ]}
      />
    </>
  );
}

/**
 * Renders a host `bash` invocation as a shell prompt (command, working
 * directory, added environment) followed by the exit code and the standard
 * output and error streams, with the command's wall time beside them. A failed
 * command's output arrives inside the error text, which the error panel shows
 * with its line breaks.
 *
 * @summary displays a shell command and its output inside a collapsible tool row
 */
export function BashTool({
  input,
  output,
  errorText,
  state,
}: BashToolProps): ReactElement {
  const command = inputSchema.safeParse(input).data;
  const result = outputSchema.safeParse(output).data;
  return (
    <ToolRow
      name="bash"
      summary={command?.command.split("\n")[0]}
      input={input}
      errorText={errorText}
      state={state}
      showInput={command === undefined}
      preview={command ? <BashCommand input={command} /> : null}
    >
      {result ? (
        <BashResult output={result} />
      ) : (
        <ToolResultFallback output={output} />
      )}
    </ToolRow>
  );
}
