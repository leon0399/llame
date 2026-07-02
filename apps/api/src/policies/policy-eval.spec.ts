import { type Policy } from '../db/schema';
import { actionMatches, evaluatePolicies } from './policy-eval';

let seq = 0;
function policy(partial: Partial<Policy>): Policy {
  seq += 1;
  return {
    id: `p-${seq}`,
    scopeType: 'user',
    scopeId: 'u1',
    effect: 'allow',
    action: '*',
    resourceType: null,
    resourceId: null,
    conditions: null,
    approval: null,
    version: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...partial,
  } as Policy;
}

describe('actionMatches', () => {
  it.each([
    ['*', 'sandbox.execute', true],
    ['sandbox.execute', 'sandbox.execute', true],
    ['sandbox.*', 'sandbox.execute', true],
    ['sandbox.*', 'sandboxy.execute', false],
    ['sandbox.execute', 'sandbox.read', false],
    ['connector.*', 'sandbox.execute', false],
  ])('%s vs %s → %s', (rule, action, expected) => {
    expect(actionMatches(rule, action)).toBe(expected);
  });
});

describe('evaluatePolicies', () => {
  const req = { action: 'sandbox.execute' };

  it('default-denies with no policies at all', () => {
    const decision = evaluatePolicies([], req);
    expect(decision.effect).toBe('deny');
    expect(decision.reason).toContain('default deny');
    expect(decision.matched).toEqual([]);
  });

  it('default-denies when policies exist but none match the action', () => {
    const decision = evaluatePolicies(
      [policy({ action: 'connector.invoke' })],
      req,
    );
    expect(decision.effect).toBe('deny');
    expect(decision.matched).toEqual([]);
  });

  it('a matching allow grants, recording the matched policy version', () => {
    const p = policy({ action: 'sandbox.*', version: 3 });
    const decision = evaluatePolicies([p], req);
    expect(decision.effect).toBe('allow');
    expect(decision.matched).toEqual([
      {
        policyId: p.id,
        version: 3,
        scopeType: 'user',
        scopeId: 'u1',
        effect: 'allow',
      },
    ]);
  });

  it('deny overrides allow, regardless of allow specificity', () => {
    const decision = evaluatePolicies(
      [
        policy({
          effect: 'deny',
          action: 'sandbox.*',
          scopeType: 'org_unit',
          scopeId: 'org1',
        }),
        policy({
          action: 'sandbox.execute',
          resourceType: 'skill',
          resourceId: 's1',
        }),
      ],
      { action: 'sandbox.execute', resourceType: 'skill', resourceId: 's1' },
    );
    expect(decision.effect).toBe('deny');
    expect(decision.reason).toContain('deny overrides allow');
    expect(decision.matched).toHaveLength(2);
  });

  it('resource filters narrow matching', () => {
    const decision = evaluatePolicies(
      [
        policy({ resourceType: 'provider', resourceId: 'openai' }),
        policy({
          effect: 'deny',
          resourceType: 'provider',
          resourceId: 'other',
        }),
      ],
      {
        action: 'sandbox.execute',
        resourceType: 'provider',
        resourceId: 'openai',
      },
    );
    expect(decision.effect).toBe('allow');
    expect(decision.matched).toHaveLength(1);
  });

  it('conditions must ALL equal context values; absent keys fail closed', () => {
    const conditional = policy({
      conditions: { network_zone: 'internal', max_cost_usd: 1 },
    });
    expect(
      evaluatePolicies([conditional], {
        action: 'sandbox.execute',
        context: { network_zone: 'internal', max_cost_usd: 1 },
      }).effect,
    ).toBe('allow');
    expect(
      evaluatePolicies([conditional], {
        action: 'sandbox.execute',
        context: { network_zone: 'internal' },
      }).effect,
    ).toBe('deny');
    expect(evaluatePolicies([conditional], req).effect).toBe('deny');
  });

  it('a narrower auto-allow cannot soften a broader always_ask (strictest wins)', () => {
    const decision = evaluatePolicies(
      [
        policy({ action: '*', approval: 'always_ask' }),
        policy({ action: 'sandbox.execute', approval: 'auto_allow_readonly' }),
      ],
      req,
    );
    expect(decision.effect).toBe('allow');
    expect(decision.approval).toBe('always_ask');
  });

  it('multiple allows resolve to the stricter approval', () => {
    const decision = evaluatePolicies(
      [
        policy({ action: 'sandbox.execute', approval: 'auto_allow_low_risk' }),
        policy({ action: 'sandbox.execute', approval: 'always_ask' }),
      ],
      req,
    );
    expect(decision.approval).toBe('always_ask');
  });

  it('an allow without approval means no approval required', () => {
    const decision = evaluatePolicies(
      [policy({ action: 'sandbox.execute' })],
      req,
    );
    expect(decision.effect).toBe('allow');
    expect(decision.approval).toBeNull();
  });
});
