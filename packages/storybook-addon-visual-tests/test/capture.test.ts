import { readFile } from "node:fs/promises";
import path from "node:path";

import { afterEach, describe, expect, test, vi } from "vitest";

import {
  createChromiumCaptureSession,
  type BrowserLauncher,
} from "../src/node/capture.js";

const temporaryFiles: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryFiles
      .splice(0)
      .map((file) =>
        import("node:fs/promises").then(({ rm }) => rm(file, { force: true })),
      ),
  );
});

describe("Chromium capture", () => {
  test("uses one browser, isolated deterministic contexts, and writes only after readiness", async () => {
    const calls: string[] = [];
    const contextOptions: unknown[] = [];
    const image = Buffer.from("png");
    const candidatePath = path.join(
      process.cwd(),
      "test/.tmp/capture-success.png",
    );
    temporaryFiles.push(candidatePath);

    const page = {
      addInitScript: vi.fn(async () => calls.push("init")),
      goto: vi.fn(async (url: string) => calls.push(`goto:${url}`)),
      evaluate: vi
        .fn()
        .mockImplementationOnce(async () => {
          calls.push("terminal");
          return {
            status: "success",
            disabled: false,
            capture: "content",
          };
        })
        .mockImplementationOnce(async () => calls.push("stabilized"))
        .mockImplementationOnce(async () => {
          calls.push("content-clip");
          return { x: 10, y: 20, width: 300, height: 200 };
        }),
      screenshot: vi.fn(async () => {
        calls.push("screenshot");
        return image;
      }),
    };
    const context = {
      newPage: vi.fn(async () => page),
      close: vi.fn(async () => undefined),
    };
    const browser = {
      newContext: vi.fn(async (options: unknown) => {
        contextOptions.push(options);
        return context;
      }),
      close: vi.fn(async () => undefined),
      version: () => "136.0",
    };
    const launcher: BrowserLauncher = {
      launch: vi.fn(async () => browser),
    };

    const session = await createChromiumCaptureSession({ launcher });
    const result = await session.capture({
      baseUrl: "http://127.0.0.1:6006/",
      storyId: "button--portal",
      candidatePath,
    });
    await session.close();

    expect(launcher.launch).toHaveBeenCalledTimes(1);
    expect(contextOptions).toEqual([
      {
        viewport: { width: 1280, height: 720 },
        deviceScaleFactor: 1,
        locale: "en-US",
        timezoneId: "UTC",
        reducedMotion: "reduce",
      },
    ]);
    expect(calls).toEqual([
      "init",
      "goto:http://127.0.0.1:6006/iframe.html?id=button--portal&viewMode=story",
      "terminal",
      "stabilized",
      "content-clip",
      "screenshot",
    ]);
    expect(page.screenshot).toHaveBeenCalledWith({
      type: "png",
      clip: { x: 10, y: 20, width: 300, height: 200 },
    });
    expect(await readFile(candidatePath)).toEqual(image);
    expect(result).toMatchObject({
      status: "captured",
      image,
      browserVersion: "136.0",
    });
  });

  test.each([
    [
      "error terminal",
      { status: "error", disabled: false, capture: "content" },
    ],
    [
      "disabled story",
      { status: "success", disabled: true, capture: "content" },
    ],
  ] as const)("does not write a candidate for %s", async (_name, readiness) => {
    const candidatePath = path.join(
      process.cwd(),
      `test/.tmp/capture-${readiness.status}-${String(readiness.disabled)}.png`,
    );
    temporaryFiles.push(candidatePath);
    const screenshot = vi.fn(async () => Buffer.from("must-not-write"));
    const launcher = fakeLauncher({ readiness, screenshot });
    const session = await createChromiumCaptureSession({ launcher });

    const result = await session.capture({
      baseUrl: "http://127.0.0.1:6006",
      storyId: "button--primary",
      candidatePath,
    });
    await session.close();

    expect(result.status).toBe(
      readiness.disabled ? "disabled" : "capture-error",
    );
    expect(screenshot).not.toHaveBeenCalled();
    await expect(readFile(candidatePath)).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  test("retries readiness after Vite replaces the navigation context", async () => {
    const candidatePath = path.join(
      process.cwd(),
      "test/.tmp/capture-reload.png",
    );
    temporaryFiles.push(candidatePath);
    const waitForLoadState = vi.fn(async () => undefined);
    const page = {
      addInitScript: vi.fn(async () => undefined),
      goto: vi.fn(async () => undefined),
      waitForLoadState,
      evaluate: vi
        .fn()
        .mockRejectedValueOnce(new Error("Execution context was destroyed"))
        .mockResolvedValueOnce({
          status: "success",
          disabled: false,
          capture: "viewport",
        })
        .mockResolvedValueOnce(undefined),
      screenshot: vi.fn(async () => Buffer.from("png")),
    };
    const launcher: BrowserLauncher = {
      launch: vi.fn(async () => ({
        version: () => "136.0",
        close: vi.fn(async () => undefined),
        newContext: vi.fn(async () => ({
          close: vi.fn(async () => undefined),
          newPage: vi.fn(async () => page),
        })),
      })),
    };
    const session = await createChromiumCaptureSession({ launcher });

    const result = await session.capture({
      baseUrl: "http://127.0.0.1:6006",
      storyId: "button--primary",
      candidatePath,
    });
    await session.close();

    expect(result.status).toBe("captured");
    expect(waitForLoadState).toHaveBeenCalledTimes(1);
    expect(page.screenshot).toHaveBeenCalledWith({ type: "png" });
  });

  test("cancellation never writes a late screenshot", async () => {
    const candidatePath = path.join(
      process.cwd(),
      "test/.tmp/capture-cancelled.png",
    );
    temporaryFiles.push(candidatePath);
    const controller = new AbortController();
    const screenshot = vi.fn(async () => Buffer.from("must-not-write"));
    const launcher = fakeLauncher({
      readiness: {
        status: "success",
        disabled: false,
        capture: "viewport",
      },
      screenshot,
      onGoto: () => controller.abort(),
    });
    const session = await createChromiumCaptureSession({ launcher });

    const result = await session.capture({
      baseUrl: "http://127.0.0.1:6006",
      storyId: "button--primary",
      candidatePath,
      signal: controller.signal,
    });
    await session.close();

    expect(result.status).toBe("cancelled");
    expect(screenshot).not.toHaveBeenCalled();
    await expect(readFile(candidatePath)).rejects.toMatchObject({
      code: "ENOENT",
    });
  });
});

function fakeLauncher(options: {
  readiness: {
    status: string;
    disabled: boolean;
    capture: "content" | "viewport";
  };
  screenshot: () => Promise<Buffer>;
  onGoto?: () => void;
}): BrowserLauncher {
  return {
    launch: vi.fn(async () => ({
      version: () => "136.0",
      close: vi.fn(async () => undefined),
      newContext: vi.fn(async () => ({
        close: vi.fn(async () => undefined),
        newPage: vi.fn(async () => ({
          addInitScript: vi.fn(async () => undefined),
          goto: vi.fn(async () => options.onGoto?.()),
          evaluate: vi
            .fn()
            .mockResolvedValueOnce(options.readiness)
            .mockResolvedValueOnce(undefined),
          screenshot: options.screenshot,
        })),
      })),
    })),
  };
}
