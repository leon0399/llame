import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import {
  CreateProjectRepositoryDto,
  toProjectRepositoryLinkResponse,
  UpdateProjectRepositoryDto,
} from './project-links.dto';

const INSTANT = new Date('2026-10-24T00:00:00.000Z');
const REPOSITORY_ID = '22222222-2222-4222-8222-222222222222';
const PROJECT_ID = '11111111-1111-4111-8111-111111111111';

const link = {
  id: '44444444-4444-4444-8444-444444444444',
  ownerUserId: 'owner-a',
  projectId: PROJECT_ID,
  repositoryId: REPOSITORY_ID,
  alias: 'llame',
  isPrimary: false,
  isolation: 'inherit' as const,
  createdAt: INSTANT,
  updatedAt: INSTANT,
};

describe('project link DTOs', () => {
  it('maps a link without leaking the row', () => {
    const response = toProjectRepositoryLinkResponse(link);

    expect(response).toMatchObject({
      id: link.id,
      repositoryId: REPOSITORY_ID,
      alias: 'llame',
      isPrimary: false,
      isolation: 'inherit',
    });
    expect(response).not.toBe(link);
  });

  it('requires a uuid repository id and accepts every isolation value', async () => {
    const [ok, each, notUuid, unknown] = await Promise.all([
      validate(
        plainToInstance(CreateProjectRepositoryDto, {
          repositoryId: REPOSITORY_ID,
        }),
      ),
      Promise.all(
        (['inherit', 'always_worktree', 'never'] as const).map((isolation) =>
          validate(
            plainToInstance(CreateProjectRepositoryDto, {
              repositoryId: REPOSITORY_ID,
              isolation,
            }),
          ),
        ),
      ),
      validate(
        plainToInstance(CreateProjectRepositoryDto, { repositoryId: 'nope' }),
      ),
      validate(
        plainToInstance(CreateProjectRepositoryDto, {
          repositoryId: REPOSITORY_ID,
          isolation: 'sometimes',
        }),
      ),
    ]);

    expect(ok).toEqual([]);
    expect(each).toEqual([[], [], []]);
    expect(notUuid).not.toEqual([]);
    expect(unknown).not.toEqual([]);
  });

  it('rejects a blank or over-long alias and a non-boolean primary flag', async () => {
    const [blank, tooLong, primary] = await Promise.all([
      validate(
        plainToInstance(CreateProjectRepositoryDto, {
          repositoryId: REPOSITORY_ID,
          alias: '   ',
        }),
      ),
      validate(
        plainToInstance(CreateProjectRepositoryDto, {
          repositoryId: REPOSITORY_ID,
          alias: 'x'.repeat(201),
        }),
      ),
      validate(
        plainToInstance(CreateProjectRepositoryDto, {
          repositoryId: REPOSITORY_ID,
          isPrimary: 'yes',
        }),
      ),
    ]);

    expect(blank).not.toEqual([]);
    expect(tooLong).not.toEqual([]);
    expect(primary).not.toEqual([]);
  });

  it('refuses an explicit null on a non-nullable link field', async () => {
    const [alias, isolation, empty] = await Promise.all([
      validate(plainToInstance(UpdateProjectRepositoryDto, { alias: null })),
      validate(
        plainToInstance(UpdateProjectRepositoryDto, { isolation: null }),
      ),
      validate(plainToInstance(UpdateProjectRepositoryDto, {})),
    ]);

    expect(alias).not.toEqual([]);
    expect(isolation).not.toEqual([]);
    expect(empty).toEqual([]);
  });
});
