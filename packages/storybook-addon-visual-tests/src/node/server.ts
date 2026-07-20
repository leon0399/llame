import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";

import type { Channel } from "storybook/internal/channels";
import type { ServerApp } from "storybook/internal/types";

import {
  ARTIFACT_ROUTE,
  COMMAND_ERROR_EVENT,
  COMMAND_EVENT,
  STATE_EVENT,
} from "../constants.js";
import { parseCommand } from "../shared/protocol.js";
import type { VisualRunState } from "../shared/results.js";
import type { VisualTestRunner } from "./runner.js";

const OPAQUE_ID = /^[A-Za-z0-9_-]{16,128}$/;

export class ArtifactRegistry {
  private readonly files = new Map<string, string>();

  register(filePath: string): string {
    const id = randomBytes(18).toString("base64url");
    this.files.set(id, filePath);
    return id;
  }

  resolve(id: string): string | undefined {
    return OPAQUE_ID.test(id) ? this.files.get(id) : undefined;
  }
}

export function registerArtifactRoute(
  app: Pick<ServerApp, "get">,
  registry: ArtifactRegistry,
  dependencies: { readFile?: (filePath: string) => Promise<Buffer> } = {},
): void {
  const load =
    dependencies.readFile ?? ((filePath: string) => readFile(filePath));
  app.get(`${ARTIFACT_ROUTE}/:artifactId`, async (request, response) => {
    const artifactId = (request as typeof request & { params?: unknown })
      .params;
    const id =
      typeof artifactId === "object" && artifactId !== null
        ? (artifactId as { artifactId?: unknown }).artifactId
        : undefined;
    const filePath = typeof id === "string" ? registry.resolve(id) : undefined;
    if (!filePath) {
      response.writeHead(404);
      response.end("Not found");
      return;
    }
    try {
      const image = await load(filePath);
      response.writeHead(200, {
        "Cache-Control": "no-store",
        "Content-Type": "image/png",
      });
      response.end(image);
    } catch {
      response.writeHead(404);
      response.end("Not found");
    }
  });
}

interface RuntimeRunner
  extends Pick<
    VisualTestRunner,
    "approve" | "cancel" | "getState" | "run" | "setOnState"
  > {}

interface RuntimeChannel extends Pick<Channel, "emit" | "on"> {}

export function installCommandHandlers(
  channel: RuntimeChannel,
  runner: RuntimeRunner,
): void {
  const emitState = (state: VisualRunState) => {
    channel.emit(STATE_EVENT, publicState(state));
  };
  runner.setOnState(emitState);
  channel.on(COMMAND_EVENT, async (raw: unknown) => {
    const command = parseCommand(raw);
    if (!command) return;

    try {
      if (command.type === "get-state") {
        emitState(runner.getState());
        return;
      }
      if (command.type === "cancel") {
        runner.cancel();
        return;
      }
      if (command.type === "approve") {
        await runner.approve(command);
        return;
      }
      await runner.run(command);
    } catch (error) {
      const storyId =
        command.type === "approve"
          ? command.storyId
          : command.type === "run" && command.scope === "current"
            ? command.storyId
            : undefined;
      channel.emit(COMMAND_ERROR_EVENT, {
        command: command.type,
        ...(storyId ? { storyId } : {}),
        message: error instanceof Error ? error.message : String(error),
      });
    }
  });
}

function publicState(state: VisualRunState): Omit<VisualRunState, "results"> & {
  results: Array<Omit<VisualRunState["results"][number], "importPath">>;
} {
  return {
    ...(state.runId ? { runId: state.runId } : {}),
    running: state.running,
    results: state.results.map(
      ({ importPath: _privatePath, ...result }) => result,
    ),
  };
}
