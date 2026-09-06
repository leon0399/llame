import { initializeConfig } from "@workspace/personal-node/config";
import { CliError } from "@workspace/personal-node/errors";
import { pathIdentity } from "@workspace/personal-node/protocol";
import { type Options } from "./arguments";
import { auth, connection } from "./auth-commands";
import { CommandSession } from "./command-session";
import { mcpCommand } from "./mcp-commands";
import { nodeCommand } from "./node-commands";
import { Output } from "./output";
import { withNode } from "./realm-commands";

export class Application {
  private readonly session: CommandSession;
  constructor(
    options: Options,
    env: NodeJS.ProcessEnv,
    output: Output,
    signal: AbortSignal,
  ) {
    this.session = new CommandSession(options, env, output, signal);
  }

  async execute(): Promise<void> {
    try {
      await this.executeCommand();
    } finally {
      await this.session.close();
    }
  }

  private async executeCommand(): Promise<void> {
    const { options } = this.session;
    const command = options.positionals[0];
    if (command === "mcp") {
      await mcpCommand(options, this.session.output, (id) =>
        this.session.local("admin.mcp.discover", {
          id,
          configIdentity: pathIdentity(options.config),
        }),
      );
      return;
    }
    if (command === "node") {
      await nodeCommand(this.session);
      return;
    }
    if (command === "remote") {
      connection(this.session);
      return;
    }
    if (command === "auth") {
      await auth(this.session, options.positionals[1] || "status");
      return;
    }
    if (command === "config") {
      configInit(this.session);
      return;
    }
    await withNode(this.session);
  }
}

function configInit(session: CommandSession): void {
  if (session.options.remote || session.options.positionals[1] !== "init")
    throw new CliError("command", "Use config init in local mode.");
  initializeConfig(session.options.config);
  session.output.notice(
    `Created ${session.options.config}; set the provider model name before running.`,
  );
}
