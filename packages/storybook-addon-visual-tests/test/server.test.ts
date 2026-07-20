import path from "node:path";

import { describe, expect, test, vi } from "vitest";

import {
  ARTIFACT_ROUTE,
  COMMAND_EVENT,
  STATE_EVENT,
} from "../src/constants.js";
import { managerEntries, previewAnnotations } from "../src/preset.js";
import {
  ArtifactRegistry,
  installCommandHandlers,
  registerArtifactRoute,
} from "../src/node/server.js";

describe("visual addon preset", () => {
  test("appends absolute manager and preview entries", async () => {
    const manager = await managerEntries(["existing-manager"]);
    const preview = await previewAnnotations(["existing-preview"]);

    expect(manager[0]).toBe("existing-manager");
    expect(preview[0]).toBe("existing-preview");
    expect(path.isAbsolute(manager[1]!)).toBe(true);
    expect(path.isAbsolute(preview[1]!)).toBe(true);
    expect(manager[1]).toMatch(
      /storybook-addon-visual-tests\/src\/manager\.tsx$/,
    );
    expect(preview[1]).toMatch(
      /storybook-addon-visual-tests\/src\/preview\.ts$/,
    );
  });
});

describe("artifact server", () => {
  test("serves only registered PNGs through opaque GET IDs", async () => {
    const registry = new ArtifactRegistry();
    const id = registry.register("/private/worktree/candidate.png");
    const app = fakeApp();
    registerArtifactRoute(app, registry, {
      readFile: vi.fn(async (file) => Buffer.from(`png:${file}`)),
    });
    expect(id).toMatch(/^[A-Za-z0-9_-]{16,128}$/);
    expect(app.get).toHaveBeenCalledWith(
      `${ARTIFACT_ROUTE}/:artifactId`,
      expect.any(Function),
    );
    expect(app.post).not.toHaveBeenCalled();

    const handler = app.get.mock.calls[0]![1];
    const response = fakeResponse();
    await handler({ params: { artifactId: id } }, response, vi.fn());

    expect(response.writeHead).toHaveBeenCalledWith(200, {
      "Cache-Control": "no-store",
      "Content-Type": "image/png",
    });
    expect(response.end).toHaveBeenCalledWith(
      Buffer.from("png:/private/worktree/candidate.png"),
    );

    const unknown = fakeResponse();
    await handler(
      { params: { artifactId: "../../private/worktree/candidate.png" } },
      unknown,
      vi.fn(),
    );
    expect(unknown.writeHead).toHaveBeenCalledWith(404);
    expect(unknown.end).toHaveBeenCalledWith("Not found");
  });
});

describe("server channel", () => {
  test("parses commands and emits path-free state", async () => {
    const listeners = new Map<string, (payload: unknown) => Promise<void>>();
    const channel = {
      on: vi.fn(
        (event: string, listener: (payload: unknown) => Promise<void>) =>
          listeners.set(event, listener),
      ),
      emit: vi.fn(),
    };
    const runner = {
      getState: vi.fn(() => ({
        runId: "run-1",
        running: false,
        results: [
          {
            runId: "run-1",
            storyId: "button--primary",
            title: "Button / Primary",
            importPath: "/private/button.stories.tsx",
            environmentKey: "chromium-1280x720@1x",
            status: "new" as const,
            artifacts: { candidate: "opaque-candidate" },
          },
        ],
      })),
      run: vi.fn(),
      cancel: vi.fn(),
      approve: vi.fn(),
      setOnState: vi.fn(),
    };
    installCommandHandlers(channel, runner);

    await listeners.get(COMMAND_EVENT)?.({ type: "get-state" });

    expect(channel.emit).toHaveBeenCalledWith(STATE_EVENT, {
      runId: "run-1",
      running: false,
      results: [
        {
          runId: "run-1",
          storyId: "button--primary",
          title: "Button / Primary",
          environmentKey: "chromium-1280x720@1x",
          status: "new",
          artifacts: { candidate: "opaque-candidate" },
        },
      ],
    });
    expect(JSON.stringify(channel.emit.mock.calls)).not.toContain("/private/");

    await listeners.get(COMMAND_EVENT)?.({
      type: "get-state",
      path: "/private/leak.png",
    });
    expect(runner.run).not.toHaveBeenCalled();
    expect(channel.emit).toHaveBeenCalledTimes(1);
  });
});

function fakeApp() {
  return {
    get: vi.fn(),
    post: vi.fn(),
  } as any;
}

function fakeResponse() {
  return {
    writeHead: vi.fn(),
    end: vi.fn(),
  };
}
