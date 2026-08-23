import {
  toKnowledgeSpaceBindingProjection,
  toKnowledgeSpaceLogicalProjection,
} from './knowledge-space.repository';

const SPACE_ID = '6f5d8a0f-7dd3-4f6b-b6ed-9e0f0b1c2d3e';

describe('Knowledge Space projections', () => {
  const row = {
    knowledgeSpaceId: SPACE_ID,
    ownerUserId: 'hosted-owner-id',
    name: 'Personal',
  };

  it('exposes only the portable stable ID in the logical projection', () => {
    expect(toKnowledgeSpaceLogicalProjection(row)).toEqual({ id: SPACE_ID });
    expect(toKnowledgeSpaceLogicalProjection(row)).not.toHaveProperty(
      'ownerUserId',
    );
    expect(toKnowledgeSpaceLogicalProjection(row)).not.toHaveProperty('root');
    expect(toKnowledgeSpaceLogicalProjection(row)).not.toHaveProperty(
      'directory',
    );
  });

  it('keeps canonical root and derived child in the private binding projection', () => {
    expect(
      toKnowledgeSpaceBindingProjection(
        row,
        '/srv/knowledge',
        `/srv/knowledge/${SPACE_ID}`,
      ),
    ).toEqual({
      id: SPACE_ID,
      name: 'Personal',
      root: '/srv/knowledge',
      directory: `/srv/knowledge/${SPACE_ID}`,
    });
  });
});
