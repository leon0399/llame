import { fileURLToPath } from "node:url";
import {withSentryConfig} from "@sentry/nextjs";

/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ["@workspace/ui"],
  turbopack: {
    // Monorepo root. Without this, Turbopack infers the workspace root from
    // lockfile locations, which picks the wrong directory in git worktrees.
    root: fileURLToPath(new URL("../..", import.meta.url)),
  },
}

export default withSentryConfig(nextConfig, {
  // For all available options, see:
  // https://www.npmjs.com/package/@sentry/webpack-plugin#options

  org: "mpty-labs",
  project: "llame",

  // Only print logs for uploading source maps in CI
  silent: !process.env.CI,

  // For all available options, see:
  // https://docs.sentry.io/platforms/javascript/guides/nextjs/manual-setup/

  // Upload a larger set of source maps for prettier stack traces (increases build time)
  widenClientFileUpload: true,

  // Route browser requests to Sentry through a Next.js rewrite to circumvent ad-blockers.
  // This can increase your server load as well as your hosting bill.
  // Note: Check that the configured route will not match with your Next.js proxy (proxy.ts), otherwise reporting of
  // client-side errors will fail.
  tunnelRoute: "/monitoring",

  // `disableLogger` and `automaticVercelMonitors` were dropped in the Sentry 10
  // upgrade: both are webpack-only (deprecated no-ops under Turbopack builds),
  // and we don't deploy on Vercel.
});
