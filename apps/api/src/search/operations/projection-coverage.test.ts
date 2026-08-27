import {
  getProjectionCoverageReport,
  type ProjectionCoverageQueryRunner,
} from './projection-coverage';

describe('getProjectionCoverageReport', () => {
  it('maps the bounded aggregate readout without exposing tenant or content fields', async () => {
    const execute = vi.fn().mockResolvedValue([
      {
        chunker_version: 4,
        chat_count: 12,
        ready_chat_count: 9,
        stale_chat_count: 3,
        document_count: 57,
        complete_document_count: 54,
      },
    ]);
    const tenantDb: ProjectionCoverageQueryRunner = {
      runAsPublic: (fn) => fn({ execute }),
    };

    await expect(getProjectionCoverageReport(tenantDb, 4)).resolves.toEqual({
      chunkerVersion: 4,
      chatCount: 12,
      readyChatCount: 9,
      staleChatCount: 3,
      documentCount: 57,
      completeDocumentCount: 54,
    });
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('fails closed when the aggregate function returns no row', async () => {
    const tenantDb: ProjectionCoverageQueryRunner = {
      runAsPublic: () => Promise.resolve([]),
    };

    await expect(getProjectionCoverageReport(tenantDb, 4)).rejects.toThrow(
      'projection coverage returned no aggregate row',
    );
  });
});
