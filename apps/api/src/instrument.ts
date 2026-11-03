/**
 * Sentry initialization for both entrypoints (main.ts and worker.ts). It must
 * be their first import: the SDK instruments modules (http, postgres.js, the
 * AI SDK) as they load, so anything required earlier goes untraced.
 */
import { config } from 'dotenv';
import * as Sentry from '@sentry/nestjs';

import { installAiSdkWarningLogger } from './ai-sdk-warnings';
import { setUpSentry } from './sentry-setup';

setUpSentry({
  env: process.env,
  entrypoint: process.argv[1],
  loadEnvFile: config,
  init: Sentry.init,
});

// Redacts reasoning metadata from adapter warnings before any model call runs
// (see the module: the SDK's default logger prints the whole skipped part).
installAiSdkWarningLogger();
