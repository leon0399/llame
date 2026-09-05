import { QUERY_METHODS, type NodeAccessPort, type NodeDescription, type NodeQuery } from '@workspace/node-protocol';
import { type UnknownRecord } from '@workspace/runtime-safety';
import { PersonalKnowledge } from './knowledge';
import { ConversationRecall } from './recall';
import { type LocalStore } from './store';
import { record } from './validation';

/** Same owner-retrieval module as the hosted adapter; no replica or tool grants. */
export class PersonalNodeAccess implements NodeAccessPort {
  constructor(private readonly store: LocalStore) {}

  describe(): NodeDescription {
    return { version: 1, kind: 'personal-node', nodeId: this.store.nodeId,
      principal: { kind: 'local-owner', id: this.store.nodeId }, modules: { core: 1, realm: 1 },
      methods: ['core.describe', ...QUERY_METHODS], execution: 'private-ipc',
      synchronization: false, enrollment: false,
      recall: { strategy: 'literal-trigram', minimumQueryCharacters: 3 }, knowledge: 'live-markdown' };
  }

  async query(query: NodeQuery, signal: AbortSignal): Promise<UnknownRecord> {
    let value: unknown;
    switch (query.method) {
      case 'realm.conversations.search': value = new ConversationRecall(this.store).search(query.params); break;
      case 'realm.conversations.read': value = new ConversationRecall(this.store).read(query.params); break;
      case 'realm.knowledge.search': value = await new PersonalKnowledge(this.store).search(query.params, signal); break;
      case 'realm.knowledge.read': value = await new PersonalKnowledge(this.store).read(query.params, signal); break;
    }
    return record(value, 'owner retrieval result');
  }
}
