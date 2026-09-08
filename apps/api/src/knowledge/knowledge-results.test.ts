import { KnowledgeFilesystemError } from './knowledge-filesystem-errors';
import {
  mapKnowledgeFailure,
  mapKnowledgeResolverFailure,
} from './knowledge-results';

describe('Knowledge failure mapping', () => {
  // Cancellation is the runner's own abort. Answering the owner with it would
  // report a working Space as broken, so both mappers must rethrow.
  it.each([mapKnowledgeFailure, mapKnowledgeResolverFailure])(
    'rethrows cancellation rather than answering the owner',
    (map) => {
      const cancelled = new KnowledgeFilesystemError('knowledge_cancelled');
      expect(() => map(cancelled)).toThrow(cancelled);
    },
  );

  it('speaks the Knowledge vocabulary for a filesystem failure', () => {
    expect(
      mapKnowledgeFailure(
        new KnowledgeFilesystemError('knowledge_limit_exceeded'),
      ),
    ).toStrictEqual({
      status: 'error',
      type: 'knowledge_limit_exceeded',
      message: 'The Knowledge operation exceeded its limit.',
    });
  });

  it.each([[new Error('disk gone')], ['not an error'], [undefined]])(
    'closes a non-Knowledge failure as unavailable: %p',
    (error) => {
      expect(mapKnowledgeFailure(error)).toStrictEqual({
        status: 'error',
        type: 'knowledge_space_unavailable',
        message: 'The Knowledge Space is unavailable.',
      });
      expect(mapKnowledgeResolverFailure(error)).toStrictEqual({
        status: 'error',
        type: 'knowledge_space_unavailable',
        message: 'The Knowledge Space is unavailable.',
      });
    },
  );

  // Binding resolution answers only in Space terms, so an unusable root keeps
  // the canonical unavailable message rather than the error's own text.
  it('reports an unavailable Space with the canonical message', () => {
    expect(
      mapKnowledgeResolverFailure(
        new KnowledgeFilesystemError('knowledge_space_unavailable'),
      ),
    ).toStrictEqual({
      status: 'error',
      type: 'knowledge_space_unavailable',
      message: 'The Knowledge Space is unavailable.',
    });
  });

  it('passes every other resolver failure to the Knowledge mapping', () => {
    expect(
      mapKnowledgeResolverFailure(
        new KnowledgeFilesystemError('knowledge_not_found'),
      ),
    ).toStrictEqual({
      status: 'error',
      type: 'knowledge_not_found',
      message: 'The Knowledge note was not found.',
    });
  });
});
