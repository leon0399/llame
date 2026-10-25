"use client";

import type { ReactElement } from "react";
import { z } from "zod";

import {
  type ToolPartProps,
  ToolResultFallback,
  ToolRow,
  ToolSection,
} from "@workspace/ui/components/custom/tool-row";

const enterInputSchema = z.object({ path: z.string() });

const enterOutputSchema = z.looseObject({
  status: z.literal("success"),
  root: z.string(),
  state: z.enum(["bound", "switched", "unchanged"]),
  authority: z.string(),
  skills: z.array(
    z.object({ name: z.string(), description: z.string().nullable() }),
  ),
  skillsOmitted: z.number(),
  mcpServers: z.array(
    z.object({
      id: z.string(),
      state: z.enum(["available", "unavailable"]),
      reason: z.string().optional(),
    }),
  ),
});

const exitOutputSchema = z.looseObject({
  status: z.literal("success"),
  state: z.enum(["exited", "unbound"]),
  previousRoot: z.string().optional(),
});

type EnterOutput = z.infer<typeof enterOutputSchema>;

/** Props for the `enter_workspace` / `exit_workspace` tool row. */
export type WorkspaceToolProps = ToolPartProps & {
  /** Which Workspace transition the call made. */
  name: "enter_workspace" | "exit_workspace";
};

const transitions = {
  bound: "Entered",
  switched: "Switched to",
  unchanged: "Already in",
} as const;

function WorkspaceList({
  label,
  items,
}: {
  label: string;
  items: ReadonlyArray<{ key: string; name: string; detail?: string }>;
}) {
  if (items.length === 0) return null;
  return (
    <ToolSection label={label}>
      <ul className="space-y-1 text-sm">
        {items.map((item) => (
          <li className="break-words" key={item.key}>
            <span className="font-medium font-mono text-xs">{item.name}</span>
            {item.detail ? (
              <span className="text-muted-foreground"> — {item.detail}</span>
            ) : null}
          </li>
        ))}
      </ul>
    </ToolSection>
  );
}

function EnteredWorkspace({ output }: { output: EnterOutput }) {
  const skills = output.skills.map((skill) => ({
    key: skill.name,
    name: skill.name,
    detail: skill.description ?? undefined,
  }));
  if (output.skillsOmitted > 0) {
    skills.push({
      key: "+omitted",
      name: `+${output.skillsOmitted} more`,
      detail: undefined,
    });
  }
  return (
    <>
      <ToolSection label={transitions[output.state]}>
        <p className="break-all font-mono text-sm">{output.root}</p>
        <p className="text-muted-foreground text-xs">{output.authority}</p>
      </ToolSection>
      <WorkspaceList label="Skills" items={skills} />
      <WorkspaceList
        label="MCP servers"
        items={output.mcpServers.map((server) => ({
          key: server.id,
          name: server.id,
          detail: [server.state, server.reason].filter(Boolean).join(", "),
        }))}
      />
    </>
  );
}

function WorkspaceResult({
  name,
  output,
}: Pick<WorkspaceToolProps, "name" | "output">) {
  const entered =
    name === "enter_workspace"
      ? enterOutputSchema.safeParse(output).data
      : undefined;
  if (entered) return <EnteredWorkspace output={entered} />;
  const exited =
    name === "exit_workspace"
      ? exitOutputSchema.safeParse(output).data
      : undefined;
  if (!exited) return <ToolResultFallback output={output} />;
  return (
    <ToolSection label={exited.previousRoot ? "Left" : "No Workspace"}>
      <p className="break-all font-mono text-sm">
        {exited.previousRoot ?? "No Workspace was entered."}
      </p>
    </ToolSection>
  );
}

/**
 * Renders an `enter_workspace` or `exit_workspace` invocation: the root the
 * Run now works in (or left), how it changed, the Workspace's proactive
 * skills and MCP servers, and the disclosure that a Workspace selects a
 * working root without confining the host.
 *
 * @summary displays a Workspace transition inside a collapsible tool row
 */
export function WorkspaceTool({
  name,
  input,
  output,
  errorText,
  state,
}: WorkspaceToolProps): ReactElement {
  const summary =
    name === "enter_workspace"
      ? enterInputSchema.safeParse(input).data?.path
      : exitOutputSchema.safeParse(output).data?.previousRoot;
  return (
    <ToolRow
      name={name}
      summary={summary}
      input={input}
      errorText={errorText}
      state={state}
      showInput={false}
    >
      <WorkspaceResult name={name} output={output} />
    </ToolRow>
  );
}
