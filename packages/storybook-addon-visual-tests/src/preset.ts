import path from "node:path";
import { fileURLToPath } from "node:url";

import type { Channel } from "storybook/internal/channels";
import type { Options, ServerApp } from "storybook/internal/types";

import { ADDON_ID } from "./constants.js";
import { VisualTestRunner } from "./node/runner.js";
import type { StoryIndexGenerator } from "./node/story-index.js";
import {
  ArtifactRegistry,
  installCommandHandlers,
  registerArtifactRoute,
} from "./node/server.js";

const directory = path.dirname(fileURLToPath(import.meta.url));
const compiled = path.basename(directory) === "dist";
const artifacts = new ArtifactRegistry();

const DEFAULT_STORY_ROOTS = ["."];
const DEFAULT_MAX_CONCURRENCY = 2;

export interface VisualTestsPresetOptions {
  storyRoots?: string[];
  maxConcurrency?: number;
}

export async function managerEntries(
  existing: string[] = [],
): Promise<string[]> {
  return [
    ...existing,
    path.join(directory, compiled ? "manager.js" : "manager.tsx"),
  ];
}

export async function previewAnnotations(
  existing: string[] = [],
): Promise<string[]> {
  return [
    ...existing,
    path.join(directory, compiled ? "preview.js" : "preview.ts"),
  ];
}

export async function experimental_serverChannel(
  channel: Channel,
  options: Options & VisualTestsPresetOptions,
): Promise<Channel> {
  // Storybook merges addon options into this object without validating them,
  // so treat both as untrusted and fail the dev server before any capture work.
  const storyRoots = resolveStoryRoots(options.storyRoots);
  const maxConcurrency = resolveMaxConcurrency(options.maxConcurrency);

  const storyIndexGenerator = (await options.presets.apply(
    "storyIndexGenerator",
  )) as StoryIndexGenerator;
  const runner = new VisualTestRunner({
    baseUrl: `http://127.0.0.1:${String(options.port)}`,
    cwd: process.cwd(),
    storyRoots,
    maxConcurrency,
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

const STORY_ROOTS_HINT = `Set "storyRoots" to a non-empty array of non-empty strings, or omit it to use the default ${JSON.stringify(DEFAULT_STORY_ROOTS)}.`;

function resolveStoryRoots(value: unknown): string[] {
  if (value === undefined) return [...DEFAULT_STORY_ROOTS];
  if (!Array.isArray(value)) {
    throw optionError(
      `Invalid "storyRoots" preset option: expected an array, received ${format(value)}. ${STORY_ROOTS_HINT}`,
    );
  }
  if (value.length === 0) {
    throw optionError(
      `Invalid "storyRoots" preset option: expected at least one story root, received an empty array. ${STORY_ROOTS_HINT}`,
    );
  }
  // Indexed rather than `.map`, which skips holes and would wave a sparse
  // array such as `new Array(3)` straight through.
  const roots: string[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const entry: unknown = value[index];
    if (typeof entry !== "string" || entry.trim() === "") {
      throw optionError(
        `Invalid "storyRoots[${String(index)}]" preset option: expected a non-empty string, received ${format(entry)}. ${STORY_ROOTS_HINT}`,
      );
    }
    roots.push(entry);
  }
  return roots;
}

function resolveMaxConcurrency(value: unknown): number {
  if (value === undefined) return DEFAULT_MAX_CONCURRENCY;
  // Number.isInteger already rejects NaN and both infinities.
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    throw optionError(
      `Invalid "maxConcurrency" preset option: expected an integer greater than 0, received ${format(value)}. Omit it to use the default ${String(DEFAULT_MAX_CONCURRENCY)}.`,
    );
  }
  return value;
}

function optionError(message: string): Error {
  return new Error(`[${ADDON_ID}] ${message}`);
}

// Never inspects the value's own properties, so a circular, null-prototype, or
// throwing-getter object still produces the intended error instead of a
// TypeError from the formatter.
function format(value: unknown): string {
  if (typeof value === "string") return JSON.stringify(value);
  if (value === null) return "null";
  if (Array.isArray(value)) return "an array";
  if (typeof value === "object") return "an object";
  if (typeof value === "function") return "a function";
  if (typeof value === "number") return String(value);
  return `${String(value)} (${typeof value})`;
}
