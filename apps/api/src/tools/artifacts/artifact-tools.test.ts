/**
 * The `artifact://` scheme through the actual `read` and `edit` tools: a read
 * needs no executor identity, and a mutation is refused.
 */

import { drizzle } from 'drizzle-orm/postgres-js';

import { type TenantRunner } from '../../db/tenant-db.service';
import { compileTestPermissionPolicy } from '../../testing/tool-permission-policy';
import { ArtifactsRepository } from './artifacts-repository';
import { nativeEditTool, nativeReadTool } from '../native-files';
import { runTool } from '../runner';
import { type ToolContext } from '../types';

const CHAT_ID = '00000000-0000-4000-8000-000000000001';
const USER_ID = 'owner-1';

function contextOf(): ToolContext {
  const db = drizzle.mock();
  const runAs: TenantRunner['runAs'] = (_userId, fn) => fn(db);

  return {
    configuredCredentials: [],
    userId: USER_ID,
    chatId: CHAT_ID,
    tenantDb: { runAs },
    permissionPolicy: compileTestPermissionPolicy(),
  };
}

describe('artifact locators through the tools', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('reads without a native executor', async () => {
    vi.spyOn(ArtifactsRepository.prototype, 'findParts').mockResolvedValue({
      createdAt: new Date('2026-11-02T10:00:00.000Z'),
      parts: [{ name: '', lineCount: 1, byteSize: 6 }],
    });

    const readPart = vi
      .spyOn(ArtifactsRepository.prototype, 'readPart')
      .mockResolvedValue({
        contentType: 'text/markdown',
        content: Buffer.from('stored\n'),
        lineCount: 1,
        findings: null,
      });

    const result = await runTool(
      nativeReadTool,
      { path: 'artifact://grep-1' },
      contextOf(),
      5,
    );

    expect(result).toMatchObject({
      status: 'success',
      path: 'artifact://grep-1',
      content: '1: stored\n',
    });
    expect(JSON.stringify(result)).not.toContain('executor_unavailable');
    expect(readPart).toHaveBeenCalledWith(CHAT_ID, 'grep', 1, '');
  });

  it('refuses edit of an artifact locator', async () => {
    const found = vi.spyOn(ArtifactsRepository.prototype, 'findParts');

    const result = await runTool(
      nativeEditTool,
      { path: 'artifact://grep-1', oldText: 'a', newText: 'b' },
      contextOf(),
      5,
    );

    expect(result).toMatchObject({ status: 'error', type: 'invalid_path' });
    expect(found).not.toHaveBeenCalled();
  });
});
