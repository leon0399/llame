import { NodeAccessClient } from "@workspace/node-client/access";
import { Auth } from "@workspace/node-client/auth";
import { NodeClient } from "@workspace/node-client/local";
import { Remote } from "@workspace/node-client/remote";
import { RemoteCursors } from "@workspace/node-client/remote-cursors";
import { type QueryMethod } from "@workspace/node-protocol";
import {
  configDocument,
  remoteConfiguration,
} from "@workspace/personal-node/config";
import { CliError } from "@workspace/personal-node/errors";
import { pathIdentity } from "@workspace/personal-node/protocol";
import { type UnknownRecord } from "@workspace/runtime-safety";
import { text, type JsonValue } from "@workspace/personal-node/validation";
import { type Options } from "./arguments";
import { Output } from "./output";
import { approvals } from "./terminal";

export class CommandSession {
  private node?: NodeClient;
  constructor(
    readonly options: Options,
    readonly env: NodeJS.ProcessEnv,
    readonly output: Output,
    readonly signal: AbortSignal,
  ) {}

  async close(): Promise<void> {
    await this.node?.close();
  }

  async localClient(): Promise<NodeClient> {
    if (!this.node) {
      this.node = await NodeClient.connect(
        this.options,
        this.env,
        this.output,
        approvals(this.output),
      ).open(this.signal);
    }
    return this.node;
  }

  async local(method: string, params: UnknownRecord = {}): Promise<JsonValue> {
    return (await this.localClient()).call(method, params, this.signal);
  }

  async access(remote?: Remote): Promise<NodeAccessClient> {
    return new NodeAccessClient(
      remote ?? (await this.localClient()),
      remote
        ? { kind: "shared-instance", principalId: remote.principalId }
        : { kind: "personal-node" },
    );
  }

  async query(
    remote: Remote | undefined,
    method: QueryMethod,
    params: UnknownRecord,
  ): Promise<void> {
    const result = await (
      await this.access(remote)
    ).query(method, params, this.signal);
    this.output.value({
      ...result.data,
      node: {
        ...result.source,
        principal: result.principal,
        authority: remote?.authority ?? null,
      },
    });
  }

  async optionalRemote(): Promise<Remote | undefined> {
    if (!this.options.remote) return undefined;
    return new Remote(
      await this.authClient().credential(this.env, this.signal),
      new RemoteCursors(this.options.data),
      this.output,
    );
  }

  authClient(): Auth {
    const remote =
      this.options.remote ??
      (this.options.modeSource !== "flag"
        ? remoteConfiguration(configDocument(this.options.config)).url
        : undefined);
    if (!remote)
      throw new CliError(
        "remote_required",
        "Configure a remote with remote enable URL or supply --remote URL. Standalone mode has no account.",
      );
    return new Auth(remote, this.options.data, this.output);
  }

  async turn(
    remote: Remote | undefined,
    chat: string,
    prompt: string,
    model?: string,
  ): Promise<void> {
    if (!text(prompt, "prompt").trim())
      throw new CliError("empty_prompt", "Prompt must not be blank.");
    if (remote) {
      await remote
        .withEffort(this.options.effort)
        .run(chat, prompt, model, this.signal);
      return;
    }
    if (this.options.native)
      this.output.notice(
        "Native Workspace enabled: OS-user authority, not a sandbox. Each edit/process still requires approval.",
      );
    await this.local("execution.run", {
      chatId: chat,
      prompt,
      model,
      native: this.options.native,
      configIdentity: pathIdentity(this.options.config),
      workspaceIdentity: this.options.native
        ? pathIdentity(this.options.cwd)
        : undefined,
    });
  }
}
