import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import type { Project } from '../../db/schema';
import {
  CreateProjectDto,
  ListProjectsQueryDto,
  toProjectResponse,
  UpdateProjectDto,
} from './projects.dto';

const project: Project = {
  id: '0b6f5499-dde4-43cf-89fe-037998a0fe64',
  ownerUserId: 'verified-user',
  name: 'Project',
  createdAt: new Date('2026-08-01T00:00:00.000Z'),
  updatedAt: new Date('2026-08-01T00:00:00.000Z'),
  archivedAt: null,
};

describe('project DTOs', () => {
  it('maps the complete project response without dropping archive state', () => {
    expect(toProjectResponse(project)).toEqual(project);
  });

  it('accepts boolean archive flags and rejects null', async () => {
    for (const archived of [true, false]) {
      await expect(
        validate(plainToInstance(UpdateProjectDto, { archived })),
      ).resolves.toEqual([]);
    }
    await expect(
      validate(plainToInstance(UpdateProjectDto, { archived: null })),
    ).resolves.not.toEqual([]);
  });

  it('rejects blank create and update names but permits omitted update names', async () => {
    const [createErrors, updateErrors, omittedErrors] = await Promise.all([
      validate(plainToInstance(CreateProjectDto, { name: '   ' })),
      validate(plainToInstance(UpdateProjectDto, { name: '   ' })),
      validate(plainToInstance(UpdateProjectDto, {})),
    ]);

    expect(createErrors).not.toEqual([]);
    expect(updateErrors).not.toEqual([]);
    expect(omittedErrors).toEqual([]);
  });

  it.each(['only', 'with'] as const)(
    'accepts archived=%s',
    async (archived) => {
      await expect(
        validate(plainToInstance(ListProjectsQueryDto, { archived })),
      ).resolves.toEqual([]);
    },
  );

  it.each(['only', 'with', 'exclude'] as const)(
    'accepts pinned=%s',
    async (pinned) => {
      await expect(
        validate(plainToInstance(ListProjectsQueryDto, { pinned })),
      ).resolves.toEqual([]);
    },
  );

  it.each(['archived', 'pinned'] as const)(
    'rejects invalid %s',
    async (key) => {
      await expect(
        validate(plainToInstance(ListProjectsQueryDto, { [key]: 'invalid' })),
      ).resolves.not.toEqual([]);
    },
  );
});
