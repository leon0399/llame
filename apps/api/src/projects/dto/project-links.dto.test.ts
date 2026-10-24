import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import type { ProjectRepositoryDefault } from '../../db/schema';
import {
  CreateProjectRepositoryDto,
  StartLocationQueryDto,
  toProjectRepositoryDefaultResponse,
  toProjectRepositoryLinkResponse,
  toProjectRepositoryLinkWithDefaultsResponse,
  UpdateProjectRepositoryDto,
} from './project-links.dto';

const INSTANT = new Date('2026-10-24T00:00:00.000Z');
const REPOSITORY_ID = '22222222-2222-4222-8222-222222222222';
const PROJECT_ID = '11111111-1111-4111-8111-111111111111';
const CHECKOUT_ID = '55555555-5555-4555-8555-555555555555';

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

const defaults: ProjectRepositoryDefault = {
  id: '66666666-6666-4666-8666-666666666666',
  ownerUserId: 'owner-a',
  projectRepositoryId: link.id,
  executorId: 'host',
  checkoutId: CHECKOUT_ID,
  createdAt: INSTANT,
  updatedAt: INSTANT,
};

describe('project link DTOs', () => {
  it('maps a link and its defaults without leaking the row', () => {
    const response = toProjectRepositoryLinkWithDefaultsResponse(link, [
      defaults,
    ]);

    expect(response).toMatchObject({
      id: link.id,
      repositoryId: REPOSITORY_ID,
      alias: 'llame',
      isPrimary: false,
      isolation: 'inherit',
      defaults: [
        {
          projectRepositoryId: link.id,
          executorId: 'host',
          checkoutId: CHECKOUT_ID,
          updatedAt: INSTANT,
        },
      ],
    });
    expect(toProjectRepositoryLinkResponse(link)).not.toBe(link);
    expect(toProjectRepositoryDefaultResponse(defaults)).not.toBe(defaults);
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

  it('validates the start-location query ids', async () => {
    const [empty, ok, badRepository, blankExecutor] = await Promise.all([
      validate(plainToInstance(StartLocationQueryDto, {})),
      validate(
        plainToInstance(StartLocationQueryDto, {
          repositoryId: REPOSITORY_ID,
          executorId: 'machine:nas',
          checkoutId: CHECKOUT_ID,
        }),
      ),
      validate(
        plainToInstance(StartLocationQueryDto, { repositoryId: 'nope' }),
      ),
      validate(plainToInstance(StartLocationQueryDto, { executorId: '  ' })),
    ]);

    expect(empty).toEqual([]);
    expect(ok).toEqual([]);
    expect(badRepository).not.toEqual([]);
    expect(blankExecutor).not.toEqual([]);
  });
});
