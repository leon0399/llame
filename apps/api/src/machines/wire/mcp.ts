import { create } from '@bufbuild/protobuf';
import {
  Transport,
  ListServersRequestSchema,
  type ListServersResponse,
} from '@workspace/machine-protocol';
import type { Handler } from './index';

type LegacyMcpServer = {
  name: string;
  state: 'available' | 'unavailable';
  transport?: 'stdio' | 'http';
  diagnostic?: string;
};

export const mcpHandlers = {
  'mcp.servers': async (session, params, options) => {
    let response: ListServersResponse;

    try {
      response = await session.clients.mcp.listServers(
        create(ListServersRequestSchema, { workspace: params.root }),
        session.callOptions(options),
      );
    } catch (error) {
      throw session.mapRefusal(error);
    }

    return { servers: mapMcpServers(response) };
  },
} satisfies Partial<Record<'mcp.servers', Handler<'mcp.servers'>>>;

export function mapMcpServers(
  response: ListServersResponse,
): Array<LegacyMcpServer> {
  return response.servers.map((server) => {
    const mapped: LegacyMcpServer = {
      name: server.name,
      state: server.available ? 'available' : 'unavailable',
    };

    if (server.transport === Transport.STDIO) mapped.transport = 'stdio';
    else if (server.transport === Transport.HTTP) mapped.transport = 'http';

    if (server.diagnostic !== '') mapped.diagnostic = server.diagnostic;

    return mapped;
  });
}
