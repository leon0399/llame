"use client";

import type { ReactElement } from "react";
import { z } from "zod";

import {
  ToolDetails,
  type ToolPartProps,
  ToolResultFallback,
  ToolRow,
  ToolSection,
} from "@workspace/ui/components/custom/tool-row";

const inputSchema = z.object({ jobs: z.array(z.string()).optional() });

const outputSchema = z.looseObject({
  status: z.literal("success"),
  jobs: z.array(
    z.looseObject({
      job: z.string(),
      state: z.string(),
      stopped_by: z.string().optional(),
    }),
  ),
});

type StopResult = z.infer<typeof outputSchema>;

export type StopToolProps = ToolPartProps;

function StopResultView({ output }: { output: StopResult }) {
  return (
    <ToolSection label="Stop result">
      <ul className="space-y-2">
        {output.jobs.map((job, index) => (
          <li
            className="rounded-md bg-muted/50 p-3"
            key={`${job.job}-${index}`}
          >
            <p className="break-all font-mono text-xs">{job.job}</p>
            <ToolDetails
              rows={[
                ["State", job.state],
                ["Stopped by", job.stopped_by],
              ]}
            />
          </li>
        ))}
      </ul>
    </ToolSection>
  );
}

/** Displays the per-job states actually returned by stop. */
export function StopTool({
  input,
  output,
  errorText,
  state,
}: StopToolProps): ReactElement {
  const stopInput = inputSchema.safeParse(input).data;
  const result = outputSchema.safeParse(output).data;

  return (
    <ToolRow
      name="stop"
      summary={stopInput?.jobs?.slice(0, 3).join(", ")}
      input={input}
      errorText={errorText}
      state={state}
    >
      {result ? (
        <StopResultView output={result} />
      ) : (
        <ToolResultFallback output={output} />
      )}
    </ToolRow>
  );
}
