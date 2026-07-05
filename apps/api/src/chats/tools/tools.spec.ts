import { getCurrentTimeTool } from './get-current-time';
import {
  BUILTIN_TOOLS,
  resolveAvailableTools,
  SAFE_BUILTIN_TOOL_NAMES,
} from './registry';
import { type BuiltinTool } from './types';

describe('get_current_time', () => {
  it('parses input, defaulting the timezone to UTC', () => {
    expect(getCurrentTimeTool.inputSchema.parse({})).toEqual({
      timezone: 'UTC',
    });
  });

  it('rejects unknown properties (strict schema)', () => {
    expect(() => {
      getCurrentTimeTool.inputSchema.parse({ timezone: 'UTC', extra: 1 });
    }).toThrow();
  });

  it('returns a structured success with a parseable ISO time', async () => {
    const result = await getCurrentTimeTool.execute({ timezone: 'UTC' });
    expect(result.status).toBe('success');
    if (result.status !== 'success') return;
    expect(typeof result.iso).toBe('string');
    expect(Number.isNaN(Date.parse(result.iso as string))).toBe(false);
    expect(result.timezone).toBe('UTC');
    expect(typeof result.unixMs).toBe('number');
  });

  it('honors a valid IANA timezone', async () => {
    const result = await getCurrentTimeTool.execute({
      timezone: 'America/New_York',
    });
    expect(result.status).toBe('success');
  });

  it('fails closed with a structured error on an unknown timezone', async () => {
    const result = await getCurrentTimeTool.execute({
      timezone: 'Mars/Olympus',
    });
    expect(result).toMatchObject({
      status: 'error',
      type: 'invalid_argument',
    });
  });

  it('is classified read_only', () => {
    expect(getCurrentTimeTool.riskClass).toBe('read_only');
  });
});

describe('resolveAvailableTools (pre-filter, fail-closed)', () => {
  const fakeRiskyTool: BuiltinTool = {
    name: 'delete_everything',
    description: 'x',
    // Deliberately MIS-tagged read_only to prove self-report cannot bypass.
    riskClass: 'read_only',
    inputSchema: getCurrentTimeTool.inputSchema,
    execute: () => ({ status: 'error', type: 'x', message: 'x' }),
  };

  it('admits the safe built-in with no policy checker', () => {
    const available = resolveAvailableTools(BUILTIN_TOOLS);
    expect(available.map((t) => t.name)).toEqual(['get_current_time']);
  });

  it('EXCLUDES a tool that is not name-allowlisted, even if it self-reports read_only', () => {
    const available = resolveAvailableTools([fakeRiskyTool]);
    expect(available).toEqual([]);
    // The allowlist is keyed on name, not the tool's own riskClass claim.
    expect(SAFE_BUILTIN_TOOL_NAMES.has(fakeRiskyTool.name)).toBe(false);
  });

  it('admits a non-safe tool only when policy explicitly ALLOWS it (#45 grant)', () => {
    expect(resolveAvailableTools([fakeRiskyTool], () => 'allow')).toEqual([
      fakeRiskyTool,
    ]);
    expect(resolveAvailableTools([fakeRiskyTool], () => 'unset')).toEqual([]);
  });

  it('DENY overrides the safe allowlist — an admin can revoke a safe tool', () => {
    // A policy deny on get_current_time excludes it despite being safe-listed.
    const decide = (t: { name: string }) =>
      t.name === 'get_current_time' ? ('deny' as const) : ('unset' as const);
    const available = resolveAvailableTools(BUILTIN_TOOLS, decide);
    expect(available.map((t) => t.name)).not.toContain('get_current_time');
  });

  it('unset (no policy) falls back to the safe allowlist', () => {
    const available = resolveAvailableTools(BUILTIN_TOOLS, () => 'unset');
    expect(available.map((t) => t.name)).toContain('get_current_time');
  });

  it('all-deny yields an empty set — the fail-closed outcome on a policy error', () => {
    // run-execution maps a policy-resolution failure to deny-every-tool; the
    // turn then completes answer-only rather than offering an unauthorized tool.
    expect(resolveAvailableTools(BUILTIN_TOOLS, () => 'deny')).toEqual([]);
  });
});
