import { z } from 'zod';

import { type BuiltinTool, type ToolResult } from './types';

const inputSchema = z
  .object({
    timezone: z
      .string()
      .max(64)
      .default('UTC')
      .describe('IANA timezone, e.g. "Europe/Berlin". Defaults to UTC.'),
  })
  .strict();

/**
 * `get_current_time` — the MVP's single read-only tool. Models cannot know the
 * wall-clock time, so this is a genuine capability gain with zero side
 * effects, no secrets, and no network. Pure aside from reading the clock.
 */
export const getCurrentTimeTool: BuiltinTool<{ timezone: string }> = {
  name: 'get_current_time',
  description:
    'Get the current date and time in a given IANA timezone. Use when the ' +
    'user asks what time or date it is; you cannot know this otherwise. Do ' +
    'not use it for time arithmetic on dates the user already provided.',
  riskClass: 'read_only',
  inputSchema,
  execute({ timezone }): ToolResult {
    const now = new Date();
    let formatted: string;
    try {
      // Intl throws RangeError on an unknown timezone — the validation seam.
      formatted = new Intl.DateTimeFormat('en-US', {
        timeZone: timezone,
        dateStyle: 'full',
        timeStyle: 'long',
      }).format(now);
    } catch {
      return {
        status: 'error',
        type: 'invalid_argument',
        message: `Unknown timezone "${timezone}". Use an IANA name like "UTC" or "America/New_York".`,
      };
    }
    return {
      status: 'success',
      iso: now.toISOString(),
      unixMs: now.getTime(),
      timezone,
      formatted,
    };
  },
};
