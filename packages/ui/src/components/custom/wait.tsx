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
  jobs: z.array(z.string()).optional(),
  timeout: z.number().optional(),
});

const waitEntrySchema = z.looseObject({
  locator: z.string(),
  state: z.string(),
  elapsedMs: z.number().optional(),
  exitDetail: z
    .looseObject({
      exitCode: z.number().nullable().optional(),
      signal: z.string().nullable().optional(),
      outcomeUnknown: z.boolean().optional(),
      stoppedBy: z.string().optional(),
    })
    .optional(),
  outputs: z
    .array(z.looseObject({ name: z.string(), text: z.string() }))
    .optional(),
  artifactLocator: z.string().optional(),
});

const outputSchema = z.looseObject({
  status: z.literal("success"),
  ended: z.enum(["settled", "timeout", "interrupted"]),
  jobs: z.array(waitEntrySchema),
  promise: z.string().optional(),
});

type WaitResult = z.infer<typeof outputSchema>;

export type WaitToolProps = ToolPartProps;

function WaitJobDetails({ job }: { job: z.infer<typeof waitEntrySchema> }) {
  return (
    <ToolDetails
      rows={[
        ["State", job.state],
        [
          "Elapsed",
          job.elapsedMs === undefined ? undefined : `${job.elapsedMs} ms`,
        ],
        [
          "Exit code",
          job.exitDetail?.exitCode == null
            ? undefined
            : String(job.exitDetail.exitCode),
        ],
        ["Signal", job.exitDetail?.signal ?? undefined],
        ["Stopped by", job.exitDetail?.stoppedBy],
        ["Outcome unknown", job.exitDetail?.outcomeUnknown ? "yes" : undefined],
        ["Artifact", job.artifactLocator],
      ]}
    />
  );
}

function WaitResultView({ output }: { output: WaitResult }) {
  return (
    <>
      <ToolSection label="Wait result" aside={output.ended}>
        <ul className="space-y-3">
          {output.jobs.map((job, index) => (
            <li
              className="space-y-1 rounded-md bg-muted/50 p-3"
              key={`${job.locator}-${index}`}
            >
              <p className="break-all font-mono text-xs">{job.locator}</p>
              <WaitJobDetails job={job} />
              {job.outputs?.map((entry, outputIndex) => (
                <ToolText
                  key={`${entry.name}-${outputIndex}`}
                  label={entry.name}
                  text={entry.text}
                />
              ))}
            </li>
          ))}
        </ul>
        {output.promise ? (
          <p className="text-muted-foreground text-sm">{output.promise}</p>
        ) : null}
      </ToolSection>
    </>
  );
}

/** Displays the actual settlement and bounded output excerpt returned by wait. */
export function WaitTool({
  input,
  output,
  errorText,
  state,
}: WaitToolProps): ReactElement {
  const waitInput = inputSchema.safeParse(input).data;
  const result = outputSchema.safeParse(output).data;

  return (
    <ToolRow
      name="wait"
      summary={waitInput?.jobs?.slice(0, 3).join(", ")}
      input={input}
      errorText={errorText}
      state={state}
      showInput={waitInput === undefined}
    >
      {result ? (
        <WaitResultView output={result} />
      ) : (
        <ToolResultFallback output={output} />
      )}
    </ToolRow>
  );
}
