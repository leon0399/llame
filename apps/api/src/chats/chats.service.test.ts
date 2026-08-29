import { drizzle } from 'drizzle-orm/postgres-js';

import * as schema from '../db/schema';
import { TenantDbService, type Db } from '../db/tenant-db.service';
import { noopEmbedDispatch } from '../search/search-embed-dispatch.stub';
import { noopReindexDispatch } from '../search/search-reindex-dispatch.stub';
import { RunAbortRegistry } from '../runs/run-abort-registry';
import { ChatsRepository } from './chats-repository';
import { ChatsService } from './chats.service';

describe('ChatsService.searchChats', () => {
  it('maps internal ranked candidates to the public web result shape', async () => {
    const db: Db = drizzle.mock({ schema });
    const tenantDb = new TenantDbService({
      transaction: async <T>(callback: (tx: Db) => Promise<T>) => callback(db),
    });
    vi.spyOn(tenantDb, 'runAs').mockImplementation(
      async <T>(_userId: string, callback: (tx: Db) => Promise<T>) =>
        callback(db),
    );
    const internalRows = [
      {
        id: 'chat-1',
        title: 'A chat',
        snippet: 'A matching excerpt',
        updatedAt: new Date('2026-08-27T00:00:00Z'),
        bestDocumentId: 'document-1',
      },
    ];
    vi.spyOn(ChatsRepository.prototype, 'searchByOwner').mockResolvedValue(
      internalRows,
    );
    const service = new ChatsService(
      tenantDb,
      new RunAbortRegistry(),
      noopReindexDispatch(),
      noopEmbedDispatch(),
    );

    await expect(service.searchChats('user-1', 'matching', 5)).resolves.toEqual(
      [
        {
          id: 'chat-1',
          title: 'A chat',
          snippet: 'A matching excerpt',
          updatedAt: new Date('2026-08-27T00:00:00Z'),
        },
      ],
    );
  });
});
