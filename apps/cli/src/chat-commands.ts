import { type Remote } from "@workspace/node-client/remote";
import { CliError } from "@workspace/personal-node/errors";
import { type UnknownRecord } from "@workspace/runtime-safety";
import { text, uuid } from "@workspace/personal-node/validation";
import { type CommandSession } from "./command-session";
import { displayValue } from "./output";

export async function chats(
  session: CommandSession,
  remote: Remote | undefined,
  action?: string,
  id?: string,
): Promise<void> {
  if (!action || action === "list") {
    session.output.value(
      remote
        ? displayValue(await remote.json("/api/v1/chats", session.signal))
        : await session.local("realm.chats.list"),
    );
    return;
  }
  if (action === "search") {
    await chatSearch(session, remote);
    return;
  }
  if (action === "read") {
    await chatRead(session, remote, id);
    return;
  }
  if (action !== "show")
    throw new CliError(
      "command",
      "Use chats list, chats show UUID, chats search QUERY, or chats read UUID SEQ.",
    );
  const chatId = uuid(id);
  session.output.value(
    remote
      ? displayValue(
          await remote.json(`/api/v1/chats/${chatId}/messages`, session.signal),
        )
      : await session.local("realm.chats.read", { chatId }),
  );
}

async function chatSearch(
  session: CommandSession,
  remote: Remote | undefined,
): Promise<void> {
  const query = text(
    session.options.positionals.slice(2).join(" "),
    "search query",
    200,
  ).trim();
  if (!query) throw new CliError("query_required", "Use chats search QUERY.");
  await session.query(remote, "realm.conversations.search", { query });
}

async function chatRead(
  session: CommandSession,
  remote: Remote | undefined,
  id?: string,
): Promise<void> {
  const args = session.options.positionals.slice(2);
  if (args.length < 2 || args.length > 4)
    throw new CliError(
      "arguments",
      "Use chats read UUID SEQ [OFFSET] [LIMIT].",
    );
  await session.query(remote, "realm.conversations.read", {
    chatId: uuid(id),
    messageSeq: Number(args[1]),
    ...optionalPage(args),
  });
}

export async function knowledge(
  session: CommandSession,
  remote: Remote | undefined,
  action = "list",
  id?: string,
): Promise<void> {
  const args = session.options.positionals.slice(2);
  if (action === "search") {
    await session.query(remote, "realm.knowledge.search", {
      query: text(args.join(" "), "query", 200),
    });
    return;
  }
  if (action === "read" && args.length >= 2 && args.length <= 4) {
    await session.query(remote, "realm.knowledge.read", {
      knowledgeSpaceId: uuid(id),
      path: args[1],
      ...optionalPage(args),
    });
    return;
  }
  if (!remote) {
    await localKnowledge(session, action, id);
    return;
  }
  await remoteKnowledge(session, remote, action, id);
}

async function remoteKnowledge(
  session: CommandSession,
  remote: Remote,
  action: string,
  id?: string,
): Promise<void> {
  if (session.options.positionals.length > 3)
    throw new CliError(
      "arguments",
      "Use knowledge list [CURSOR] or knowledge show UUID.",
    );
  if (action === "list") {
    const query = new URLSearchParams({ limit: "50" });
    if (id) query.set("after", text(id, "Knowledge Space cursor", 2048));
    session.output.value(
      displayValue(
        await remote.json(`/api/v1/knowledge-spaces?${query}`, session.signal),
      ),
    );
    return;
  }
  if (action === "show") {
    session.output.value(
      displayValue(
        await remote.json(
          `/api/v1/knowledge-spaces/${uuid(id)}`,
          session.signal,
        ),
      ),
    );
    return;
  }
  throw new CliError(
    "command",
    "Use knowledge list/show/search/read; create is local-only in this CLI.",
  );
}

async function localKnowledge(
  session: CommandSession,
  action: string,
  id?: string,
): Promise<void> {
  const args = session.options.positionals.slice(2);
  if (action === "list" && !args.length) {
    session.output.value(await session.local("realm.knowledge.list"));
    return;
  }
  if (action === "create") {
    session.output.value(
      await session.local("realm.knowledge.create", {
        name: text(args.join(" "), "Knowledge name", 100),
      }),
    );
    return;
  }
  if (action === "show" && args.length === 1) {
    session.output.value(
      await session.local("realm.knowledge.get", {
        knowledgeSpaceId: uuid(id),
      }),
    );
    return;
  }
  throw new CliError(
    "command",
    "Use knowledge list/create NAME/show UUID/search QUERY/read UUID PATH [OFFSET] [LIMIT].",
  );
}

function optionalPage(args: Array<string>): UnknownRecord {
  const page: UnknownRecord = {};
  if (args[2] !== undefined) page.offset = Number(args[2]);
  if (args[3] !== undefined) page.limit = Number(args[3]);
  return page;
}
