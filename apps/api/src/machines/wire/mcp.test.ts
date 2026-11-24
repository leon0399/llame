import { Transport } from '@workspace/machine-protocol';
import { mcpHandlers } from './mcp';
import type { MachineRequestOptions, MachineSession } from '../machine-session';

const options = { budgetMs: 5000 };

describe('MCP wire handlers', () => {
  it('maps ListServers records into the legacy result shape', async () => {
    const listServers = vi.fn().mockResolvedValue({
      servers: [
        { name: 'stdio', transport: Transport.STDIO, available: true, diagnostic: '' },
        { name: 'http', transport: Transport.HTTP, available: false, diagnostic: 'unset {env:TOKEN}' },
        { name: 'unknown', transport: Transport.UNSPECIFIED, available: false, diagnostic: '' },
      ],
    });
    const callOptions = vi.fn((value: MachineRequestOptions) => value);
    const session = {
      clients: { mcp: { listServers } },
      callOptions,
    } as unknown as MachineSession;

    await expect(mcpHandlers['mcp.servers'](session, {
      envelope: { budgetMs: 5000 },
      root: '/workspace',
    }, options)).resolves.toEqual({
      servers: [
        { name: 'stdio', transport: 'stdio', state: 'available' },
        { name: 'http', transport: 'http', state: 'unavailable', diagnostic: 'unset {env:TOKEN}' },
        { name: 'unknown', state: 'unavailable' },
      ],
    });
    expect(listServers).toHaveBeenCalledWith(expect.objectContaining({ workspace: '/workspace' }), options);
    expect(callOptions).toHaveBeenCalledWith(options);
  });

});
