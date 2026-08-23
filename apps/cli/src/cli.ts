import path from "node:path";
import { createInterface } from "node:readline/promises";

import {
  createOpenAIModelClient,
  executeRun,
  type ModelClient,
  SessionLog,
  type LoopTool,
  type RunEvent,
} from "@workspace/harness";

import { createInteractiveApprovalGate } from "./approval";
import { CliConfigError, loadCliConfig } from "./config";
import { createCodingTools } from "./tools";

/**
 * The effective system prompt for every CLI run: what the assistant is, the
 * exact workspace it may touch, and the narration contract. Bound verbatim
 * into each run's context receipt.
 */
export function buildSystemPrompt(workspaceRoot: string): string {
  return [
    "You are llame's local coding harness, running in a user's terminal.",
    `Workspace root (the ONLY directory you may read or change): ${workspaceRoot}`,
    "",
    "Rules:",
    "- Use the provided tools to inspect and change files; do not invent paths.",
    "- Paths are relative to the workspace root; anything outside it is refused.",
    "- Write-class tools require explicit user approval per call — expect refusals",
    "  and adjust instead of retrying the same call.",
    "- Prefer small, verifiable edits. Report what you changed and why.",
  ].join("\n");
}

export function sessionFilePath(env: NodeJS.ProcessEnv): string {
  const home =
    env.LLAME_HOME?.trim() || path.join(process.env.HOME ?? ".", ".llame");
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  return path.join(home, "sessions", `${stamp}.jsonl`);
}

function printEvent(event: RunEvent): void {
  switch (event.type) {
    case "run_started":
      process.stdout.write(
        `\n— run: model=${event.receipt.model} tools=[${event.receipt.advertisedTools.join(", ")}] maxSteps=${event.receipt.maxSteps}\n`,
      );
      break;
    case "text_delta":
      process.stdout.write(event.text);
      break;
    case "reasoning_delta":
      break;
    case "tool_started": {
      const summary = JSON.stringify(event.input);
      process.stdout.write(
        `\n  ⏺ ${event.toolName}(${summary.length > 120 ? `${summary.slice(0, 120)}…` : summary})\n`,
      );
      break;
    }
    case "tool_completed":
      if (event.result.status === "error") {
        process.stdout.write(
          `  ⏺ ${event.toolName} → error[${event.result.type}]: ${event.result.message}\n`,
        );
      } else {
        process.stdout.write(`  ⏺ ${event.toolName} → ok\n`);
      }
      break;
    case "tool_unavailable":
      process.stdout.write(
        `\n  ⏺ ${event.toolName} → unavailable (${event.reason})\n`,
      );
      break;
    case "step_cap_reached":
      process.stdout.write(
        "\n  ⏺ step cap reached — answering from context\n",
      );
      break;
    case "run_finished":
      process.stdout.write("\n");
      break;
  }
}

interface TurnDeps {
  session: SessionLog;
  tools: Map<string, LoopTool>;
  client: ModelClient;
  system: string;
  approvalGate: ReturnType<typeof createInteractiveApprovalGate>;
  maxSteps?: number;
}

async function runTurn(prompt: string, deps: TurnDeps): Promise<void> {
  await deps.session.append({ type: "user_prompt", text: prompt });
  try {
    const outcome = await executeRun({
      client: deps.client,
      system: deps.system,
      messages: deps.session.deriveMessages(),
      registry: deps.tools,
      approvalGate: deps.approvalGate,
      maxSteps: deps.maxSteps,
      onEvent: (event) => {
        // Fire-and-forget durability: the audit trail must not corrupt the
        // stream, and a failed append is never fatal mid-run.
        void deps.session
          .append({ type: "run_event", event })
          .catch(() => undefined);
        printEvent(event);
      },
    });
    await deps.session.append({
      type: "assistant_messages",
      messages: outcome.responseMessages,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`\nharness error: ${message}\n`);
  }
}

async function readPrompt(): Promise<string | undefined> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const line = await rl.question("\nllame> ");
    return line.trim();
  } catch {
    return undefined;
  } finally {
    // Closed between prompts so the approval gate owns stdin during a run.
    rl.close();
  }
}

/**
 * Entry point: one-shot with prompt arguments, REPL otherwise.
 */
export async function runCli(
  argv: readonly string[],
  env: NodeJS.ProcessEnv,
): Promise<number> {
  let config;
  try {
    config = loadCliConfig(env, path.join(process.cwd(), "llame.cli.json"));
  } catch (error) {
    if (error instanceof CliConfigError) {
      process.stderr.write(`llame: ${error.message}\n`);
      return 2;
    }
    throw error;
  }

  const workspaceRoot = process.cwd();
  // contextWindowTokens feeds API-side compaction sizing; the CLI has no
  // compaction yet, so a nominal window carries no behavior here.
  const client = createOpenAIModelClient({
    providerModelId: config.model,
    modelId: config.model,
    contextWindowTokens: 128_000,
    baseUrl: config.baseUrl,
    credential: config.apiKey,
  });
  const tools = createCodingTools(workspaceRoot);
  const session = await SessionLog.open(sessionFilePath(env));
  const system = buildSystemPrompt(workspaceRoot);
  const approvalGate = createInteractiveApprovalGate();
  const deps: TurnDeps = {
    session,
    tools,
    client,
    system,
    approvalGate,
    maxSteps: config.maxSteps,
  };

  if (argv.length > 0) {
    await runTurn(argv.join(" "), deps);
    return 0;
  }

  process.stdout.write(
    `llame cli — workspace ${workspaceRoot}\nsession ${sessionFilePath(env)}\n(Ctrl+C or Ctrl+D exits)\n`,
  );
  for (;;) {
    const prompt = await readPrompt();
    if (prompt === undefined || prompt === "") return 0;
    await runTurn(prompt, deps);
  }
}
