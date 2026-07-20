import path from "node:path";
import { fileURLToPath } from "node:url";

import type { Channel } from "storybook/internal/channels";
import type { Options, ServerApp } from "storybook/internal/types";

import { VisualTestRunner } from "./node/runner.js";
import type { StoryIndexGenerator } from "./node/story-index.js";
import {
  ArtifactRegistry,
  installCommandHandlers,
  registerArtifactRoute,
} from "./node/server.js";

const directory = path.dirname(fileURLToPath(import.meta.url));
const artifacts = new ArtifactRegistry();

export async function managerEntries(
  existing: string[] = [],
): Promise<string[]> {
  return [...existing, path.join(directory, "manager.tsx")];
}

export async function previewAnnotations(
  existing: string[] = [],
): Promise<string[]> {
  return [...existing, path.join(directory, "preview.ts")];
}

export async function experimental_serverChannel(
  channel: Channel,
  options: Options & { storyRoots?: string[]; maxConcurrency?: number },
): Promise<Channel> {
  const storyIndexGenerator = (await options.presets.apply(
    "storyIndexGenerator",
  )) as StoryIndexGenerator;
  const runner = new VisualTestRunner({
    baseUrl: `http://127.0.0.1:${String(options.port)}`,
    cwd: process.cwd(),
    storyRoots: options.storyRoots ?? ["."],
    ...(options.maxConcurrency
      ? { maxConcurrency: options.maxConcurrency }
      : {}),
    storyIndexGenerator,
    artifactRegistry: artifacts,
  });
  installCommandHandlers(channel, runner);
  return channel;
}

export async function experimental_devServer(
  app: ServerApp,
): Promise<ServerApp> {
  registerArtifactRoute(app, artifacts);
  return app;
}
