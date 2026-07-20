import { createRequire } from "node:module";

import { chromium } from "playwright";

import { DEFAULT_ENVIRONMENT } from "../constants.js";
import type { VisualCaptureMode } from "../shared/capture.js";

const require = createRequire(import.meta.url);
const playwrightVersion = (
  require("playwright/package.json") as { version: string }
).version;

interface CapturePage {
  on?(
    event: "console" | "pageerror",
    listener:
      | ((message: { type(): string; text(): string }) => void)
      | ((error: Error) => void),
  ): void;
  addInitScript(script: () => void): Promise<unknown>;
  goto(url: string): Promise<unknown>;
  waitForLoadState?(state: "load"): Promise<unknown>;
  evaluate<T, A>(
    script: (argument: A) => Promise<T> | T,
    argument: A,
  ): Promise<T>;
  evaluate<T>(script: () => Promise<T> | T): Promise<T>;
  screenshot(options: {
    type: "png";
    clip?: { x: number; y: number; width: number; height: number };
  }): Promise<Buffer>;
}

interface CaptureContext {
  newPage(): Promise<CapturePage>;
  close(): Promise<unknown>;
}

interface CaptureBrowser {
  newContext(options: {
    viewport: { width: number; height: number };
    deviceScaleFactor: number;
    locale: string;
    timezoneId: string;
    reducedMotion: "reduce";
  }): Promise<CaptureContext>;
  close(): Promise<unknown>;
  version(): string;
}

export interface BrowserLauncher {
  launch(options?: { headless?: boolean }): Promise<CaptureBrowser>;
}

export interface CaptureRequest {
  baseUrl: string;
  storyId: string;
  signal?: AbortSignal;
}

export type CaptureResult =
  | {
      status: "captured";
      image: Buffer;
      browserVersion: string;
      playwrightVersion?: string;
    }
  | { status: "disabled" }
  | { status: "capture-error"; message: string }
  | { status: "cancelled" };

export interface ChromiumCaptureSession {
  capture(request: CaptureRequest): Promise<CaptureResult>;
  close(): Promise<void>;
}

export async function createChromiumCaptureSession(
  options: {
    launcher?: BrowserLauncher;
  } = {},
): Promise<ChromiumCaptureSession> {
  const launcher = options.launcher ?? (chromium as unknown as BrowserLauncher);
  const browser = await launcher.launch({ headless: true });
  return new PlaywrightCaptureSession(browser);
}

class PlaywrightCaptureSession implements ChromiumCaptureSession {
  constructor(private readonly browser: CaptureBrowser) {}

  async capture(request: CaptureRequest): Promise<CaptureResult> {
    if (request.signal?.aborted) return { status: "cancelled" };

    let context: CaptureContext | undefined;
    const consoleDiagnostics: string[] = [];
    const pageErrors: string[] = [];
    const cancel = () => {
      void context?.close().catch(() => undefined);
    };

    try {
      context = await this.browser.newContext({
        viewport: DEFAULT_ENVIRONMENT.viewport,
        deviceScaleFactor: DEFAULT_ENVIRONMENT.deviceScaleFactor,
        locale: "en-US",
        timezoneId: "UTC",
        reducedMotion: "reduce",
      });
      request.signal?.addEventListener("abort", cancel, { once: true });
      const page = await context.newPage();
      page.on?.("console", (message: { type(): string; text(): string }) => {
        if (message.type() === "error") consoleDiagnostics.push(message.text());
      });
      page.on?.("pageerror", (error: Error) => pageErrors.push(error.message));
      await page.addInitScript(installPreviewBridge);
      await page.goto(storyUrl(request.baseUrl, request.storyId));
      if (request.signal?.aborted) return { status: "cancelled" };

      const readiness = await waitForStoryAfterReload(page, request.storyId);
      if (request.signal?.aborted) return { status: "cancelled" };
      if (readiness.disabled) return { status: "disabled" };
      if (readiness.status !== "success") {
        return {
          status: "capture-error",
          message: `Story ${request.storyId} finished with an error`,
        };
      }

      await stabilizePage(page);
      if (request.signal?.aborted) return { status: "cancelled" };
      if (pageErrors.length > 0) {
        return {
          status: "capture-error",
          message: `Story ${request.storyId} raised a page error: ${pageErrors.join("; ")}`,
        };
      }
      const image = await page.screenshot(
        readiness.capture === "content"
          ? { type: "png", clip: await contentClip(page) }
          : { type: "png" },
      );
      if (request.signal?.aborted) return { status: "cancelled" };
      return {
        status: "captured",
        image,
        browserVersion: this.browser.version(),
        playwrightVersion,
      };
    } catch (error) {
      if (request.signal?.aborted) return { status: "cancelled" };
      return {
        status: "capture-error",
        message: `${error instanceof Error ? error.message : "Visual capture failed"}${pageErrors.length > 0 ? `; page errors: ${pageErrors.join("; ")}` : ""}${consoleDiagnostics.length > 0 ? `; console errors: ${consoleDiagnostics.join("; ")}` : ""}`,
      };
    } finally {
      request.signal?.removeEventListener("abort", cancel);
      await context?.close().catch(() => undefined);
    }
  }

  async close(): Promise<void> {
    await this.browser.close();
  }
}

async function waitForStoryAfterReload(
  page: CapturePage,
  storyId: string,
): Promise<{
  status: "error" | "success";
  disabled: boolean;
  capture: VisualCaptureMode;
}> {
  try {
    return await waitForStory(page, storyId);
  } catch (error) {
    if (
      !(error instanceof Error) ||
      !error.message.includes("Execution context was destroyed")
    ) {
      throw error;
    }
    await page.waitForLoadState?.("load");
    return waitForStory(page, storyId);
  }
}

function storyUrl(baseUrl: string, storyId: string): string {
  const root = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  const url = new URL("iframe.html", root);
  url.searchParams.set("id", storyId);
  url.searchParams.set("viewMode", "story");
  return url.toString();
}

async function waitForStory(
  page: CapturePage,
  storyId: string,
): Promise<{
  status: "error" | "success";
  disabled: boolean;
  capture: VisualCaptureMode;
}> {
  return page.evaluate(async (id) => {
    const bridge = globalThis.__LLAME_VISUAL_TESTS__;
    if (!bridge) throw new Error("Visual preview bridge was not installed");
    const report = await Promise.race([
      bridge.wait(id),
      new Promise<never>((_resolve, reject) =>
        setTimeout(
          () =>
            reject(
              new Error(
                `Timed out waiting for Storybook readiness: ${JSON.stringify(bridge.get(id))}`,
              ),
            ),
          15_000,
        ),
      ),
    ]);
    if (report.status !== "error" && report.status !== "success") {
      throw new Error("Story did not produce a terminal result");
    }
    return {
      status: report.status,
      disabled: report.disabled === true,
      capture: report.capture === "viewport" ? "viewport" : "content",
    };
  }, storyId);
}

async function stabilizePage(page: CapturePage): Promise<void> {
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => resolve()),
    );
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => resolve()),
    );
  });
}

async function contentClip(
  page: CapturePage,
): Promise<{ x: number; y: number; width: number; height: number }> {
  return page.evaluate(() => {
    const padding = 8;
    const rectangles = [...document.body.querySelectorAll("*")]
      .filter((element) => {
        const style = getComputedStyle(element);
        if (
          style.display === "none" ||
          style.visibility === "hidden" ||
          Number(style.opacity) === 0
        ) {
          return false;
        }
        const rectangle = element.getBoundingClientRect();
        return (
          rectangle.width > 0 &&
          rectangle.height > 0 &&
          rectangle.right > 0 &&
          rectangle.bottom > 0 &&
          rectangle.left < globalThis.innerWidth &&
          rectangle.top < globalThis.innerHeight
        );
      })
      .map((element) => element.getBoundingClientRect());

    if (rectangles.length === 0) {
      return {
        x: 0,
        y: 0,
        width: globalThis.innerWidth,
        height: globalThis.innerHeight,
      };
    }

    const left = Math.max(
      0,
      Math.floor(
        Math.min(...rectangles.map((rectangle) => rectangle.left)) - padding,
      ),
    );
    const top = Math.max(
      0,
      Math.floor(
        Math.min(...rectangles.map((rectangle) => rectangle.top)) - padding,
      ),
    );
    const right = Math.min(
      globalThis.innerWidth,
      Math.ceil(
        Math.max(...rectangles.map((rectangle) => rectangle.right)) + padding,
      ),
    );
    const bottom = Math.min(
      globalThis.innerHeight,
      Math.ceil(
        Math.max(...rectangles.map((rectangle) => rectangle.bottom)) + padding,
      ),
    );

    return {
      x: left,
      y: top,
      width: Math.max(1, right - left),
      height: Math.max(1, bottom - top),
    };
  });
}

function installPreviewBridge(): void {
  type Report = {
    storyId: string;
    status?: "error" | "success";
    disabled?: boolean;
    capture?: VisualCaptureMode;
  };
  type Waiter = (report: Report) => void;
  const reports = new Map<string, Report>();
  const waiters = new Map<string, Waiter[]>();
  const complete = (report: Report) =>
    report.status !== undefined &&
    report.disabled !== undefined &&
    report.capture !== undefined;

  globalThis.__LLAME_VISUAL_TESTS__ = {
    report(update: Report) {
      const report = { ...reports.get(update.storyId), ...update };
      reports.set(update.storyId, report);
      if (!complete(report)) return;
      for (const resolve of waiters.get(update.storyId) ?? []) resolve(report);
      waiters.delete(update.storyId);
    },
    async wait(storyId: string) {
      const existing = reports.get(storyId);
      if (existing && complete(existing)) return existing;
      return new Promise<Report>((resolve) => {
        waiters.set(storyId, [...(waiters.get(storyId) ?? []), resolve]);
      });
    },
    get(storyId: string) {
      return reports.get(storyId);
    },
  };
}
