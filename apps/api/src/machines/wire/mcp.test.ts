import { create } from '@bufbuild/protobuf';
import {
  ListServersResponseSchema,
  Transport,
} from '@workspace/machine-protocol';
import { mapMcpServers } from './mcp';

describe('MCP wire handlers', () => {
  it('maps ListServers records into the legacy result shape', () => {
    const response = create(ListServersResponseSchema, {
      servers: [
        {
          name: 'stdio',
          transport: Transport.STDIO,
          available: true,
          diagnostic: '',
        },
        {
          name: 'http',
          transport: Transport.HTTP,
          available: false,
          diagnostic: 'unset {env:TOKEN}',
        },
        {
          name: 'unknown',
          transport: Transport.UNSPECIFIED,
          available: false,
          diagnostic: '',
        },
      ],
    });

    expect(mapMcpServers(response)).toEqual([
      { name: 'stdio', transport: 'stdio', state: 'available' },
      {
        name: 'http',
        transport: 'http',
        state: 'unavailable',
        diagnostic: 'unset {env:TOKEN}',
      },
      { name: 'unknown', state: 'unavailable' },
    ]);
  });
});
