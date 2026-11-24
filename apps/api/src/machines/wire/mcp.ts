import { create } from '@bufbuild/protobuf';
import { Transport, ListServersRequestSchema, type ListServersResponse } from '@workspace/machine-protocol';
import type { Handler } from './index';

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
    return {
      servers: response.servers.map((server) => ({
        name: server.name,
        state: server.available ? 'available' : 'unavailable',
        ...(server.transport === Transport.STDIO
          ? { transport: 'stdio' as const }
          : server.transport === Transport.HTTP
            ? { transport: 'http' as const }
            : {}),
        ...(server.diagnostic === '' ? {} : { diagnostic: server.diagnostic }),
      })),
    };
  },
} satisfies Partial<Record<'mcp.servers', Handler<'mcp.servers'>>>;


