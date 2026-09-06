import {
  configDocument,
  remoteConfiguration,
  configureRemote,
} from "@workspace/personal-node/config";
import { CliError } from "@workspace/personal-node/errors";
import { text } from "@workspace/personal-node/validation";
import { type CommandSession } from "./command-session";
import { password, question, readStdin } from "./terminal";

export function connection(session: CommandSession): void {
  const [, action = "status", url, ...extra] = session.options.positionals;
  if (extra.length || (action !== "enable" && url))
    throw new CliError(
      "arguments",
      "Use remote enable [URL], remote disable, or remote status.",
    );
  if (action === "status") {
    session.output.value({
      remote: remoteConfiguration(configDocument(session.options.config)),
    });
    return;
  }
  if (action !== "enable" && action !== "disable")
    throw new CliError(
      "command",
      "Use remote enable [URL], remote disable, or remote status.",
    );
  const remote = configureRemote(
    session.options.config,
    action === "enable",
    url,
  );
  session.output.value({ remote, authentication: "unchanged" });
  session.output.notice(
    remote.enabled
      ? "Remote is now the default. Use auth login to authenticate, or --local for one standalone invocation."
      : "Local is now the default. Saved remote credentials were retained; auth logout revokes a session.",
  );
}

export async function auth(
  session: CommandSession,
  action: string,
): Promise<void> {
  const client = session.authClient();
  const signal = AbortSignal.any([session.signal, AbortSignal.timeout(30_000)]);
  if (action === "forget") {
    client.forget();
    session.output.notice(
      "Local credential removed. Remote session was NOT revoked.",
    );
    return;
  }
  if (action === "login") {
    await authLogin(session, client, signal);
    return;
  }
  if (action === "import") {
    await authImport(session, client, signal);
    return;
  }
  if (action !== "status" && action !== "logout")
    throw new CliError("command", "Unknown auth command. Use --help.");
  if (action === "logout") {
    await authLogout(session, client, signal);
    return;
  }
  const credential = await client.credential(session.env, signal);
  session.output.value({
    authenticated: true,
    authority: credential.authority,
    userId: credential.userId,
    source: credential.source,
    enrolled: false,
  });
}

async function authLogin(
  session: CommandSession,
  client: ReturnType<CommandSession["authClient"]>,
  signal: AbortSignal,
): Promise<void> {
  const email = session.options.email || (await question("Email: ", signal));
  const secret = session.options.passwordStdin
    ? await readStdin(1024, signal)
    : await password(signal);
  const credential = await client.login(
    email,
    text(secret, "password", 256),
    signal,
  );
  session.output.value({
    authenticated: true,
    authority: credential.authority,
    userId: credential.userId,
    enrolled: false,
  });
}

async function authImport(
  session: CommandSession,
  client: ReturnType<CommandSession["authClient"]>,
  signal: AbortSignal,
): Promise<void> {
  if (!session.options.tokenStdin)
    throw new CliError(
      "token_input",
      "Use auth import --token-stdin. Tokens are never accepted in argv.",
    );
  const credential = await client.importToken(
    await readStdin(4096, signal),
    signal,
  );
  session.output.value({
    authenticated: true,
    authority: credential.authority,
    userId: credential.userId,
    enrolled: false,
  });
}

async function authLogout(
  session: CommandSession,
  client: ReturnType<CommandSession["authClient"]>,
  signal: AbortSignal,
): Promise<void> {
  const current = client.session(session.env);
  await client.logout(current, signal);
  session.output.notice(
    current.source === "environment"
      ? "Remote session revoked or already expired. LLAME_TOKEN was used; there was no saved local credential to remove."
      : "Remote session revoked or already expired; its saved local credential was removed.",
  );
}
