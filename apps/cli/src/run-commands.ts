import { type Remote } from "@workspace/node-client/remote";
import { CliError } from "@workspace/personal-node/errors";
import { isNumber, type UnknownRecord } from "@workspace/runtime-safety";
import { record, uuid } from "@workspace/personal-node/validation";
import { setTimeout as delay } from "node:timers/promises";
import { type CommandSession } from "./command-session";
import { displayValue } from "./output";

export async function runs(
  session: CommandSession,
  remote: Remote | undefined,
  action?: string,
  id?: string,
): Promise<void> {
  if (action === "list" && !remote && !id) {
    session.output.value(await session.local("execution.runs.list"));
    return;
  }
  const runId = uuid(id);
  if (action === "show") {
    session.output.value(
      remote
        ? displayValue(
            await remote.json(`/api/v1/runs/${runId}`, session.signal),
          )
        : await session.local("execution.runs.get", { runId }),
    );
    return;
  }
  if (action === "events" || action === "follow") {
    if (remote)
      await remote.follow(runId, session.signal, session.options.after);
    else await localEvents(session, runId, action === "follow");
    return;
  }
  if (action === "tools" || action === "receipt") {
    await runReceipt(session, remote, runId, action);
    return;
  }
  await runControl(session, remote, runId, action);
}

async function runReceipt(
  session: CommandSession,
  remote: Remote | undefined,
  runId: string,
  action: string,
): Promise<void> {
  if (session.options.positionals.length !== 3)
    throw new CliError("arguments", "Use runs tools/receipt UUID.");
  const receipt = await loadReceipt(session, remote, runId);
  session.output.value(
    action === "receipt" ? receipt : toolsView(runId, remote, receipt),
  );
}

async function loadReceipt(
  session: CommandSession,
  remote: Remote | undefined,
  runId: string,
): Promise<UnknownRecord> {
  if (remote)
    return record(
      await remote.json(
        `/api/v1/runs/${runId}/context-receipt`,
        session.signal,
      ),
      "context receipt",
    );
  return record(
    record(await session.local("execution.runs.get", { runId }), "local Run")
      .snapshot,
    "local context receipt",
  );
}

function toolsView(
  runId: string,
  remote: Remote | undefined,
  receipt: UnknownRecord,
): UnknownRecord {
  return {
    runId,
    mode: remote ? "remote" : "local",
    tools: receipt.tools,
    toolAvailability: receipt.toolAvailability ?? {
      version: 0,
      state: "unobserved",
    },
    availabilityHash: receipt.availabilityHash ?? null,
    historical: true,
  };
}

async function runControl(
  session: CommandSession,
  remote: Remote | undefined,
  runId: string,
  action?: string,
): Promise<void> {
  if (!remote) {
    if (action === "cancel") {
      session.output.value(
        await session.local("execution.runs.cancel", { runId }),
      );
      return;
    }
    throw new CliError(
      "command",
      "Use runs list/show/events/follow/tools/receipt/cancel locally.",
    );
  }
  if (action === "attach") {
    await remote.attach(runId, session.signal);
    return;
  }
  if (action === "cancel") {
    session.output.value(
      displayValue(
        await remote.json(`/api/v1/runs/${runId}`, session.signal, "PATCH", {
          status: "cancelled",
        }),
      ),
    );
    return;
  }
  throw new CliError("command", "Unknown runs command. Use --help.");
}

async function localEvents(
  session: CommandSession,
  runId: string,
  follow: boolean,
): Promise<void> {
  let after = session.options.after ?? 0;
  for (;;) {
    const page = record(
      await session.local("execution.runs.events", { runId, after }),
      "events page",
    );
    after = writeEvents(session, page, after);
    if (page.hasMore === true) continue;
    if (!follow || page.status !== "running") return;
    await delay(100, undefined, { signal: session.signal });
  }
}

function writeEvents(
  session: CommandSession,
  page: UnknownRecord,
  after: number,
): number {
  if (!Array.isArray(page.events))
    throw new CliError("node_protocol", "Invalid events page.");
  let sequence = after;
  for (const event of page.events) {
    const entry = record(event, "event");
    if (!isNumber(entry.sequence) || entry.sequence <= sequence)
      throw new CliError("node_protocol", "Invalid event sequence.");
    session.output.value(entry);
    sequence = entry.sequence;
  }
  return sequence;
}
