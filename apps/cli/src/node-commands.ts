import { Remote } from "@workspace/node-client/remote";
import { RemoteCursors } from "@workspace/node-client/remote-cursors";
import { CliError } from "@workspace/personal-node/errors";
import { recoverServer } from "@workspace/personal-node/socket";
import { type CommandSession } from "./command-session";

export async function nodeCommand(session: CommandSession): Promise<void> {
  const [, action = "status", ...extra] = session.options.positionals;
  if (extra.length)
    throw new CliError(
      "arguments",
      "Use node serve/status/recover/capabilities.",
    );
  if (action === "capabilities") {
    await nodeCapabilities(session);
    return;
  }
  if (session.options.remote)
    throw new CliError(
      "arguments",
      "Use node serve/status/recover locally; use node capabilities for the selected remote.",
    );
  if (action === "serve") {
    await nodeServe(session);
    return;
  }
  if (action === "recover") {
    recoverServer(session.options.data);
    session.output.value({ endpointRecovered: true, actionsReplayed: false });
    return;
  }
  if (action !== "status")
    throw new CliError(
      "command",
      "Use node serve/status/recover or node capabilities.",
    );
  session.output.value(await session.local("core.status"));
}

async function nodeCapabilities(session: CommandSession): Promise<void> {
  const remote = session.options.remote
    ? new Remote(
        await session.authClient().credential(session.env, session.signal),
        new RemoteCursors(session.options.data),
        session.output,
      )
    : undefined;
  session.output.value({
    ...(await (await session.access(remote)).describe(session.signal)),
    authority: remote?.authority ?? null,
  });
}

async function nodeServe(session: CommandSession): Promise<void> {
  const { serveNode } = await import("@workspace/node/server");
  await serveNode({
    data: session.options.data,
    config: session.options.config,
    cwd: session.options.cwd,
    native: session.options.native,
    transport: "unix",
    env: session.env,
  });
}
