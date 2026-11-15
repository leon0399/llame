// This file configures the initialization of Sentry on the client.
// https://docs.sentry.io/platforms/javascript/guides/nextjs/
//
// The SDK with Replay is ~120 KB of gzipped JavaScript, so it is kept off the
// first-load path: it is fetched after the window `load` event, and not at all
// when no DSN is configured. Errors thrown before it loads are not reported.

import type * as SentrySdk from "@sentry/nextjs";

import { getApiUrl } from "@/lib/api/fetch";

type SentryModule = typeof SentrySdk;

let sentry: SentryModule | undefined;

async function startSentry(): Promise<void> {
  // Code-split on purpose: a static import would put the SDK in every route's
  // first-load bundle.
  const sdk = await import("@sentry/nextjs");
  sdk.init({
    dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
    // The deployment names itself; a production build (`next build`, E2E,
    // worktrees) is not a production deployment, so NODE_ENV is not used.
    environment: process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT || "local",
    integrations: [
      sdk.replayIntegration(),
      sdk.consoleLoggingIntegration({ levels: ["log", "error", "warn"] }),
    ],
    tracesSampleRate: 1,
    // The API is another origin, so its requests carry the browser's trace
    // headers only when listed here; the API continues that trace.
    tracePropagationTargets: [getApiUrl()],
    replaysSessionSampleRate: 0.1,
    replaysOnErrorSampleRate: 1.0,
    debug: false,
  });
  sentry = sdk;
}

if (process.env.NEXT_PUBLIC_SENTRY_DSN) {
  if (document.readyState === "complete") {
    void startSentry();
  } else {
    window.addEventListener("load", () => void startSentry(), { once: true });
  }
}

export const onRouterTransitionStart: SentryModule["captureRouterTransitionStart"] =
  (...args) => sentry?.captureRouterTransitionStart(...args);
