/**
 * Sentry initialization for both entrypoints (main.ts and worker.ts). It must
 * be their first import: the SDK instruments modules (http, postgres.js, the
 * AI SDK) as they load, so anything required earlier goes untraced.
 */
import { config } from 'dotenv';
import * as Sentry from '@sentry/nestjs';

import { setUpSentry } from './sentry-setup';

setUpSentry({
  env: process.env,
  entrypoint: process.argv[1],
  loadEnvFile: config,
  init: Sentry.init,
});
