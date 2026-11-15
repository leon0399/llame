import { interruptSettlementOf } from './tool-settlement';

describe('interruptSettlementOf (run-steering D7)', () => {
  it('settles an unstarted read as not run and a started remote command as unknown', () => {
    const bash = interruptSettlementOf({
      toolName: 'bash',
      started: true,
      mcpDispatched: false,
    });

    const read = interruptSettlementOf({
      toolName: 'read',
      started: false,
      mcpDispatched: false,
    });

    expect(read).toEqual({
      result: {
        status: 'error',
        type: 'cancelled',
        message:
          'This call did not run. The owner interrupted the step before it started. Run it again if you still need it.',
      },
      stopped: false,
    });
    // Only remote bash reaches this fallback; host calls return a job result.
    expect(bash).toMatchObject({
      result: { status: 'error', type: 'outcome_unknown' },
      stopped: true,
    });
  });

  it('settles a started read-only call as cancelled, with no stopped call', () => {
    expect(
      interruptSettlementOf({
        toolName: 'web_search',
        started: true,
        mcpDispatched: false,
      }),
    ).toEqual({
      result: {
        status: 'error',
        type: 'cancelled',
        message:
          'The owner interrupted this call before it finished. It made no change.',
      },
      stopped: false,
    });
  });

  it('settles a sent MCP call as outcome_unknown and names it as stopped', () => {
    expect(
      interruptSettlementOf({
        toolName: 'mcp__docs__search',
        started: true,
        mcpDispatched: true,
      }),
    ).toMatchObject({
      result: { status: 'error', type: 'outcome_unknown' },
      stopped: true,
    });
  });

  it('settles an MCP call that never sent its request as not run', () => {
    expect(
      interruptSettlementOf({
        toolName: 'mcp__docs__search',
        started: true,
        mcpDispatched: false,
      }),
    ).toMatchObject({
      result: { status: 'error', type: 'cancelled' },
      stopped: false,
    });
  });
});
