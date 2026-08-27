import {
  getProjectionCoverageReport,
  type ProjectionCoverageQueryRunner,
} from './projection-coverage';

describe('getProjectionCoverageReport', () => {
  const validRow = {
    chunker_version: 4,
    chat_count: 12,
    ready_chat_count: 9,
    stale_chat_count: 3,
    document_count: 57,
    complete_document_count: 54,
  };

  it('maps the bounded aggregate readout without exposing tenant or content fields', async () => {
    const execute = vi.fn().mockResolvedValue([validRow]);
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

  it('fails closed when the aggregate function returns multiple rows', async () => {
    const execute = vi.fn().mockResolvedValue([validRow, validRow]);
    const tenantDb: ProjectionCoverageQueryRunner = {
      runAsPublic: (fn) => fn({ execute }),
    };

    await expect(getProjectionCoverageReport(tenantDb, 4)).rejects.toThrow(
      'expected exactly one aggregate row, received 2',
    );
  });

  it.each([
    ['chunker_version', null],
    ['chat_count', '12'],
    ['ready_chat_count', Number.NaN],
    ['stale_chat_count', Number.POSITIVE_INFINITY],
    ['document_count', -1],
    ['complete_document_count', Number.MAX_SAFE_INTEGER + 1],
  ])('rejects invalid %s values', async (field, value) => {
    const execute = vi
      .fn()
      .mockResolvedValue([{ ...validRow, [field]: value }]);
    const tenantDb: ProjectionCoverageQueryRunner = {
      runAsPublic: (fn) => fn({ execute }),
    };

    await expect(getProjectionCoverageReport(tenantDb, 4)).rejects.toThrow(
      `projection coverage field '${field}' must be a finite non-negative safe integer`,
    );
  });

  it('rejects a missing aggregate field', async () => {
    const missing = {
      chunker_version: validRow.chunker_version,
      ready_chat_count: validRow.ready_chat_count,
      stale_chat_count: validRow.stale_chat_count,
      document_count: validRow.document_count,
      complete_document_count: validRow.complete_document_count,
    };
    const execute = vi.fn().mockResolvedValue([missing]);
    const tenantDb: ProjectionCoverageQueryRunner = {
      runAsPublic: (fn) => fn({ execute }),
    };

    await expect(getProjectionCoverageReport(tenantDb, 4)).rejects.toThrow(
      'expected exactly chat_count, chunker_version, complete_document_count, document_count, ready_chat_count, stale_chat_count',
    );
  });

  it('rejects a non-object aggregate row', async () => {
    const execute = vi.fn().mockResolvedValue([null]);
    const tenantDb: ProjectionCoverageQueryRunner = {
      runAsPublic: (fn) => fn({ execute }),
    };

    await expect(getProjectionCoverageReport(tenantDb, 4)).rejects.toThrow(
      'returned a non-object aggregate row',
    );
  });

  it('rejects zero or mismatched requested chunker versions', async () => {
    const zero = vi
      .fn()
      .mockResolvedValue([{ ...validRow, chunker_version: 0 }]);
    const mismatch = vi
      .fn()
      .mockResolvedValue([{ ...validRow, chunker_version: 5 }]);
    const zeroDb: ProjectionCoverageQueryRunner = {
      runAsPublic: (fn) => fn({ execute: zero }),
    };
    const mismatchDb: ProjectionCoverageQueryRunner = {
      runAsPublic: (fn) => fn({ execute: mismatch }),
    };

    await expect(getProjectionCoverageReport(zeroDb, 4)).rejects.toThrow(
      'chunker_version must be positive',
    );
    await expect(getProjectionCoverageReport(mismatchDb, 4)).rejects.toThrow(
      'does not match requested 4',
    );
  });

  it('rejects malformed requested chunker versions before database access', async () => {
    const runAsPublic = vi.fn();
    const tenantDb: ProjectionCoverageQueryRunner = { runAsPublic };

    await expect(
      getProjectionCoverageReport(tenantDb, Number.NaN),
    ).rejects.toThrow(
      'requested chunker version must be a positive safe integer',
    );
    expect(runAsPublic).not.toHaveBeenCalled();
  });
});
