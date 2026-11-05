import pino from 'pino';

import { type UnknownRecord } from '@workspace/runtime-safety';

/**
 * The one structured line a decision call emits. Decision calls are side
 * calls, so they are accounted here and never folded into a Run's message
 * usage aggregate (run-usage-accounting: only the Run's own model requests
 * count). A `decision.completed` RunEvent is deliberately out of scope for
 * this experimental slice.
 */
export type DecisionLogger = {
  info(payload: UnknownRecord): void;
};

export const decisionLogger: DecisionLogger = pino({
  name: 'decisions',
  enabled: process.env.NODE_ENV !== 'test',
});
