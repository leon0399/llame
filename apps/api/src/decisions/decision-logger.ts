import pino from 'pino';

import { type UnknownRecord } from '@workspace/runtime-safety';

/**
 * The one structured line a decision call emits. Decision calls are side
 * calls, so they are accounted here and never folded into a Run's message
 * usage aggregate (run-usage-accounting: only the Run's own model requests
 * count). The line carries `tool`, `model`, `cards`, `requests`, `judged`,
 * `inputTokens`, `outputTokens`, `costUsd`, and `latencyMs`.
 */
export type DecisionLogger = {
  info(payload: UnknownRecord): void;
};

export const decisionLogger: DecisionLogger = pino({
  name: 'decisions',
  enabled: process.env.NODE_ENV !== 'test',
});
