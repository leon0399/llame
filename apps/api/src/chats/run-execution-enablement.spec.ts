import {
  applyEnablement,
  parseEnabledTools,
} from '../runs/run-execution.service';

describe('parseEnabledTools (TOOLS_ENABLED env)', () => {
  it('is empty when unset or blank', () => {
    expect(parseEnabledTools(undefined).size).toBe(0);
    expect(parseEnabledTools('').size).toBe(0);
    expect(parseEnabledTools(',,').size).toBe(0);
  });

  it('trims and drops empty entries', () => {
    const set = parseEnabledTools(' remember , recall ,');
    expect([...set].sort()).toEqual(['recall', 'remember']);
  });
});

describe('applyEnablement (operator enablement composes with policy)', () => {
  const enabled = new Set(['remember', 'danger']);
  const remember = { name: 'remember', riskClass: 'write_internal' as const };
  const danger = { name: 'danger', riskClass: 'destructive' as const };

  it('upgrades only the unset verdict for an enabled, env-enablable tool', () => {
    expect(applyEnablement('unset', remember, enabled)).toBe('allow');
  });

  it('does NOT enable a tool that is not in the operator set', () => {
    expect(
      applyEnablement(
        'unset',
        { name: 'other', riskClass: 'read_only' },
        enabled,
      ),
    ).toBe('unset');
  });

  it('refuses to env-enable a high-risk tool even if listed (needs a policy allow)', () => {
    // `destructive` is not env-enablable — TOOLS_ENABLED can't grant it.
    expect(applyEnablement('unset', danger, enabled)).toBe('unset');
  });

  it('never overrides a policy DENY (deny-overrides holds)', () => {
    expect(applyEnablement('deny', remember, enabled)).toBe('deny');
  });

  it('leaves an explicit policy ALLOW unchanged', () => {
    expect(applyEnablement('allow', remember, enabled)).toBe('allow');
  });
});
