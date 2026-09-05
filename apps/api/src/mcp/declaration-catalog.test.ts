import { describe, expect, it } from 'vitest';
import { composeTurnToolCatalog } from '../tools/turn-tool-catalog';
import { type Tool } from '../tools/types';
import { type UnknownRecord } from '@workspace/runtime-safety';
import { admitMcpToolDefinitions, type AdmittedMcpToolDefinition } from '@workspace/tool-runtime/declaration-admission';
const definition = (name: string, inputSchema: UnknownRecord) => ({ name, description: `Use ${name}`, inputSchema });
function asTool(admitted: AdmittedMcpToolDefinition): Tool {
  return {
    id: admitted.id,
    description: admitted.description,
    inputSchema: admitted.inputSchema,
    classification: 'read_only',
    execute: () => ({ status: 'success' }),
  };
}

describe('admitted MCP declarations in the API catalog', () => {
  it('produces a stable canonical declaration hash for equivalent safe schemas', async () => {
    const [first, second] = await Promise.all([
      admitMcpToolDefinitions({
        serverId: 'web',
        protectedValues: [],
        definitions: [
          definition('search', {
            type: 'object',
            properties: { query: { type: 'string', minLength: 1 } },
          }),
        ],
      }),
      admitMcpToolDefinitions({
        serverId: 'web',
        protectedValues: [],
        definitions: [
          definition('search', {
            properties: { query: { minLength: 1, type: 'string' } },
            type: 'object',
          }),
        ],
      }),
    ]);
    const catalogs = await Promise.all(
      [first, second].map(({ admitted }) =>
        composeTurnToolCatalog({
          allowedToolRules: ['mcp__web__search'],
          callTimeoutSeconds: 15,
          candidates: [
            {
              source: { type: 'mcp', serverId: 'web' },
              state: 'available',
              tool: asTool(admitted[0]),
            },
          ],
        }),
      ),
    );

    expect(catalogs[0].admitted[0].declarationHash).toBe(
      catalogs[1].admitted[0].declarationHash,
    );
  });
});
