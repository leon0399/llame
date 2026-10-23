/**
 * Sentry for the daemon, active only when the box sets `SENTRY_DSN`. It must
 * be the CLI's first import so the SDK is ready before any session starts.
 * stdout is the protocol channel; the SDK writes nothing there.
 */
import * as Sentry from "@sentry/node";
import { sentryOptions } from "./env";

const options = sentryOptions();
if (options !== undefined) {
  Sentry.init({
    ...options,
    tracesSampleRate: 1,
    // The daemon is one bundled file, so the SDK's module-load hooks have no
    // packages to instrument; skipping them also keeps stderr quiet.
    enableRuntimeChannelInjection: false,
    // Requests the daemon makes (Workspace MCP servers over HTTP) get no
    // trace headers; the hub's trace arrives in each request envelope.
    tracePropagationTargets: [],
    // Files, commands, and their output belong to the box's owner and may
    // hold secrets, so only structural data leaves the process.
    dataCollection: {
      userInfo: false,
      cookies: false,
      httpHeaders: false,
      httpBodies: [],
      urlQueryParams: false,
      genAI: { inputs: false, outputs: false },
      databaseQueryData: false,
      queues: false,
      stackFrameVariables: false,
    },
    initialScope: { tags: { "llame.process": "machine" } },
  });
  // The process exits as soon as its session ends, before the SDK's batched
  // spans are sent; closing the client sends them first.
  process.once("beforeExit", () => {
    void Sentry.close(2000);
  });
}
