import { tool, type ToolSet } from 'ai';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { canonicalJson } from '../canonical-json';
import { toFlexibleSchema } from './schema-utils';
import {
  AttemptToolAdditions,
  type AttemptToolBinding,
} from './attempt-tool-additions';
import { type ModelToolDeclaration } from '../db/schema';
import { type Tool } from './types';

const SERVER = 'workspace';
const TOOL_ID = 'mcp__workspace__lookup';

function makeTool(
  id = TOOL_ID,
  description = 'Look up a value.',
  execute: Tool['execute'] = () => ({ status: 'success', value: 'ok' }),
): Tool {
  return {
    id,
    description,
    classification: 'unverified',
    inputSchema: z.object({ value: z.string().optional() }),
    execute,
  };
}

function modelTool(declaration: ModelToolDeclaration): ToolSet[string] {
  const inputSchema = toFlexibleSchema(declaration.inputSchema);
  if (inputSchema === null) throw new Error('invalid test schema');
  return tool({
    description: declaration.description,
    inputSchema,
    execute: () => ({ status: 'success', value: 'model' }),
  });
}

function setup(
  boundExecutables = new Map<string, AttemptToolBinding>(),
  record: ToolSet = {},
) {
  const persist = vi.fn().mockResolvedValue(true);
  const additions = new AttemptToolAdditions({
    allowedToolRules: [`mcp__${SERVER}__*`],
    callTimeoutSeconds: 15,
    boundExecutables,
    createTool: modelTool,
    persist,
  });
  additions.bindToolRecord(record);
  return { additions, boundExecutables, persist, record };
}

describe('AttemptToolAdditions', () => {
  it('persists and inserts an admitted declaration into the bound tool record', async () => {
    const first = makeTool();
    const state = setup();

    await expect(state.additions.add(SERVER, [first], 2)).resolves.toEqual({
      added: [TOOL_ID],
      availableFromNextRun: [],
      refused: [],
    });

    expect(state.record[TOOL_ID]).toBeDefined();
    expect(state.boundExecutables.get(TOOL_ID)?.executor).toBe(first);
    expect(state.persist).toHaveBeenCalledWith([
      { id: TOOL_ID, source: 'workspace-mcp', server: SERVER, step: 2 },
    ]);
  });

  it('rebinds an identical retained declaration after its server is disabled', async () => {
    const first = makeTool();
    const second = makeTool();
    const state = setup();

    await state.additions.add(SERVER, [first], 1);
    state.additions.disableServer(SERVER);
    expect(state.boundExecutables.get(TOOL_ID)?.executor).not.toBe(first);

    await expect(state.additions.add(SERVER, [second], 3)).resolves.toEqual({
      added: [TOOL_ID],
      availableFromNextRun: [],
      refused: [],
    });
    expect(state.boundExecutables.get(TOOL_ID)?.executor).toBe(second);
  });

  it('defers a changed declaration and retains the unavailable executor', async () => {
    const first = makeTool();
    const changed = makeTool(TOOL_ID, 'A changed declaration.');
    const state = setup();

    await state.additions.add(SERVER, [first], 1);
    state.additions.disableServer(SERVER);
    const before = state.boundExecutables.get(TOOL_ID);
    const result = await state.additions.add(SERVER, [changed], 2);

    expect(result).toEqual({
      added: [],
      availableFromNextRun: [TOOL_ID],
      refused: [],
    });
    expect(state.boundExecutables.get(TOOL_ID)).toEqual(before);
    expect(
      canonicalJson(state.boundExecutables.get(TOOL_ID)?.declaration),
    ).toContain('Look up a value.');
    expect(state.persist).toHaveBeenCalledTimes(1);
  });

  it('refuses a declaration that collides by ASCII case with a retained id', async () => {
    const state = setup();
    await state.additions.add(SERVER, [makeTool()], 1);
    const collision = makeTool('mcp__workspace__LOOKUP');

    await expect(state.additions.add(SERVER, [collision], 2)).resolves.toEqual({
      added: [],
      availableFromNextRun: [],
      refused: [
        {
          id: 'mcp__workspace__LOOKUP',
          reason: 'case-only collision with an existing tool id',
        },
      ],
    });
    expect(state.persist).toHaveBeenCalledTimes(1);
  });

  it('keeps a disabled declaration callable as a non-fatal unavailable result', async () => {
    const state = setup();
    await state.additions.add(SERVER, [makeTool()], 1);
    state.additions.disableAll();

    const executor = state.additions.executorFor(TOOL_ID);
    if (executor === undefined) throw new Error('expected retained executor');
    expect(
      await executor.execute(
        { userId: 'u', chatId: 'c', tenantDb: { runAs: vi.fn() } },
        {},
      ),
    ).toEqual({
      status: 'error',
      type: 'not_available',
      message: `Tool "${TOOL_ID}" is not available.`,
    });
  });
  it('refuses declarations that fail allowlist or schema admission', async () => {
    const state = setup();
    const refused = await state.additions.add(
      SERVER,
      [
        makeTool('mcp__other__lookup'),
        {
          ...makeTool(),
          inputSchema: { type: 'not-a-schema' },
        },
      ],
      1,
    );

    expect(refused.added).toEqual([]);
    expect(refused.refused).toEqual([
      { id: 'mcp__other__lookup', reason: 'not_allowlisted' },
      { id: TOOL_ID, reason: 'declaration_refused' },
    ]);
    expect(state.persist).not.toHaveBeenCalled();
  });

  it('does not mutate memory when the attempt fence rejects persistence', async () => {
    const record: ToolSet = {};
    const persist = vi.fn().mockResolvedValue(false);
    const state = new AttemptToolAdditions({
      allowedToolRules: [`mcp__${SERVER}__*`],
      callTimeoutSeconds: 15,
      boundExecutables: new Map(),
      createTool: modelTool,
      persist,
    });
    state.bindToolRecord(record);

    await expect(state.add(SERVER, [makeTool()], 1)).resolves.toEqual({
      added: [],
      availableFromNextRun: [],
      refused: [{ id: TOOL_ID, reason: 'attempt_not_current' }],
    });
    expect(record).toEqual({});
  });
});
