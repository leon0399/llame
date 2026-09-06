import { type Remote } from "@workspace/node-client/remote";
import { CliError } from "@workspace/personal-node/errors";
import { pathIdentity } from "@workspace/personal-node/protocol";
import { record } from "@workspace/personal-node/validation";
import { randomUUID } from "node:crypto";
import { chats, knowledge } from "./chat-commands";
import { type CommandSession } from "./command-session";
import { displayValue } from "./output";
import { runs } from "./run-commands";
import { question, readStdin } from "./terminal";

export async function withNode(session: CommandSession): Promise<void> {
  const [command, action, id] = session.options.positionals;
  if (await dispatchRealm(session, command, action, id)) return;
  if (command && command !== "run")
    throw new CliError("command", "Unknown command. Use --help.");
  const remote = await session.optionalRemote();
  if (command === "run" || !process.stdin.isTTY) {
    await runPrompt(session, remote, command === "run");
    return;
  }
  await repl(session, remote);
}

async function dispatchRealm(
  session: CommandSession,
  command: string | undefined,
  action: string | undefined,
  id: string | undefined,
): Promise<boolean> {
  if (command === "status") {
    await statusCommand(session);
    return true;
  }
  if (isSearchRebuild(command, action, id, session.options.remote)) {
    session.output.value(await session.local("admin.search.rebuild"));
    return true;
  }
  if (command === "recover") {
    await recoverCommand(session);
    return true;
  }
  if (command === "models") {
    await models(session, await session.optionalRemote());
    return true;
  }
  if (command === "knowledge") {
    await knowledge(session, await session.optionalRemote(), action, id);
    return true;
  }
  if (command === "chats") {
    await chats(session, await session.optionalRemote(), action, id);
    return true;
  }
  if (command === "runs") {
    await runs(session, await session.optionalRemote(), action, id);
    return true;
  }
  return false;
}

function isSearchRebuild(
  command: string | undefined,
  action: string | undefined,
  id: string | undefined,
  remote: string | undefined,
): boolean {
  return command === "search" && action === "rebuild" && !id && !remote;
}

async function statusCommand(session: CommandSession): Promise<void> {
  const local = session.options.remote
    ? undefined
    : record(await session.local("core.status"), "Node status");
  session.output.value({
    mode: session.options.remote ? "remote" : "local",
    modeSource: session.options.modeSource,
    remote: session.options.remote ?? null,
    ...local,
    enrolled: false,
  });
}

async function recoverCommand(session: CommandSession): Promise<void> {
  if (session.options.remote)
    throw new CliError(
      "command",
      "recover applies only to the local executor.",
    );
  await session.local("admin.recover");
  session.output.notice(
    "Local recovery complete. Interrupted runs were marked; no action was replayed.",
  );
}

async function models(session: CommandSession, remote?: Remote): Promise<void> {
  session.output.value(
    remote
      ? displayValue(await remote.json("/api/v1/models", session.signal))
      : await session.local("realm.models.list", {
          configIdentity: pathIdentity(session.options.config),
        }),
  );
}

async function runPrompt(
  session: CommandSession,
  remote: Remote | undefined,
  sliced: boolean,
): Promise<void> {
  const words = session.options.positionals.slice(sliced ? 1 : 0);
  if (!words.length && process.stdin.isTTY)
    throw new CliError(
      "prompt_required",
      "Provide a prompt, or use run - to read until EOF.",
    );
  if (!words.length || words.join(" ") === "-")
    session.output.notice(
      "Reading prompt from standard input (Ctrl-C cancels).",
    );
  const prompt =
    words.length && words.join(" ") !== "-"
      ? words.join(" ")
      : await readStdin(80_000, session.signal);
  await session.turn(
    remote,
    session.options.chat || randomUUID(),
    prompt,
    session.options.model,
  );
}

interface ReplState {
  chat: string;
  model?: string;
}

async function repl(session: CommandSession, remote?: Remote): Promise<void> {
  let state: ReplState = {
    chat: session.options.chat || randomUUID(),
    model: session.options.model,
  };
  session.output.notice(
    `llame ${remote ? "remote" : "local"} · /help for commands · chat=${state.chat}`,
  );
  for (;;) {
    const line = (await question("llame> ", session.signal)).trim();
    if (!line) continue;
    const next = await replLine(session, remote, state, line);
    if (next === undefined) return;
    state = next;
  }
}

async function replLine(
  session: CommandSession,
  remote: Remote | undefined,
  state: ReplState,
  line: string,
): Promise<ReplState | undefined> {
  if (line.startsWith("/")) return applySlash(session, remote, state, line);
  try {
    await session.turn(remote, state.chat, line, state.model);
  } catch (error) {
    if (session.signal.aborted) throw error;
    session.output.notice(
      error instanceof CliError
        ? `${error.code}: ${error.message}`
        : "Run failed. Inspect recorded events.",
    );
  }
  return state;
}

async function applySlash(
  session: CommandSession,
  remote: Remote | undefined,
  state: ReplState,
  line: string,
): Promise<ReplState | undefined> {
  if (line === "/exit") return undefined;
  if (line === "/help") {
    session.output.notice(
      "/new · /model ID · /history · /exit. Ctrl-C exits; remote work continues.",
    );
    return state;
  }
  if (line === "/new") {
    const chat = randomUUID();
    session.output.notice(`chat=${chat}`);
    return { chat, model: state.model };
  }
  if (line.startsWith("/model ")) {
    const model = line.slice(7).trim();
    session.output.notice(`model=${model}`);
    return { chat: state.chat, model };
  }
  if (line === "/history") {
    await chats(session, remote, "show", state.chat);
    return state;
  }
  session.output.notice("Unknown slash command. Use /help.");
  return state;
}
