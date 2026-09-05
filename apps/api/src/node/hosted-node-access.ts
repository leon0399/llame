import { Inject, Injectable } from '@nestjs/common';
import {
  QUERY_METHODS,
  QUERY_TOOL_IDS,
  NodeProtocolError,
  type NodeAccessPort,
  type NodeDescription,
  type NodeQuery,
} from '@workspace/node-protocol';
import { type UnknownRecord } from '@workspace/runtime-safety';
import { TenantDbService, type TenantRunner } from '../db/tenant-db.service';
import { InstanceConfigService, type InstanceConfigReader } from '../instance-config/instance-config.service';
import { KnowledgeToolRuntimeResolver } from '../knowledge/knowledge-tool-runtime-resolver';
import { knowledgeSearchTool, knowledgeReadTool } from '../knowledge/knowledge-tools';
import { searchConversationsTool } from '../tools/search-conversations';
import { conversationReadTool } from '../tools/conversation-read';
import { matchesCodeOwnedToolId } from '../tools/tool-id';
import { type KnowledgeToolResolver, type ToolContext } from '../tools/types';

/** Adapts existing owner-scoped capabilities. Does not instantiate another agent. */
@Injectable()
export class HostedNodeAccess {
  constructor(
    @Inject(TenantDbService)
    private readonly tenantDb: TenantRunner,
    @Inject(InstanceConfigService)
    private readonly instance: InstanceConfigReader,
    @Inject(KnowledgeToolRuntimeResolver)
    private readonly knowledge: KnowledgeToolResolver,
  ) {}

  forOwner(authenticatedUserId: string): NodeAccessPort {
    return {
      describe: () => this.describe(authenticatedUserId),
      query: (query, signal) => this.query(authenticatedUserId, query, signal),
    };
  }

  private describe(userId: string): NodeDescription {
    const methods = QUERY_METHODS.filter(method => {
      if (!matchesCodeOwnedToolId(QUERY_TOOL_IDS[method], this.instance.config.tools.allowed)) return false;
      return !method.startsWith('realm.knowledge.') || this.instance.config.knowledge.root !== undefined;
    });
    return { version: 1, kind: 'shared-instance', nodeId: null,
      principal: { kind: 'session-user', id: userId }, modules: { core: 1, realm: 1 },
      methods: ['core.describe', ...methods], execution: 'hosted-queued', synchronization: false, enrollment: false,
      recall: { strategy: 'canonical-postgres', minimumQueryCharacters: 1 }, knowledge: 'live-markdown' };
  }

  private async query(userId: string, query: NodeQuery, signal: AbortSignal): Promise<UnknownRecord> {
    // Recheck policy at invocation, not merely discovery. No generic tool ID from input.
    if (!this.describe(userId).methods.includes(query.method)) {
      throw new NodeProtocolError('capability_unavailable', 'The requested retrieval capability is unavailable.', -32601);
    }
    const context: ToolContext = { userId, tenantDb: this.tenantDb, abortSignal: signal,
      // There is no initiating Chat for a human read query. This field grants nothing.
      chatId: '00000000-0000-4000-8000-000000000000', knowledgeResolver: this.knowledge };
    switch (query.method) {
      case 'realm.conversations.search': return searchConversationsTool.execute(context, query.params);
      case 'realm.conversations.read': return conversationReadTool.execute(context, query.params);
      case 'realm.knowledge.search': return knowledgeSearchTool.execute(context, query.params);
      case 'realm.knowledge.read': return knowledgeReadTool.execute(context, query.params);
    }
  }
}
