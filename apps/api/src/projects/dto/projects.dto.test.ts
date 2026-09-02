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

  it('accepts a partial update with an explicit archive flag', async () => {
    await expect(
      validate(plainToInstance(UpdateProjectDto, { archived: true })),
    ).resolves.toEqual([]);
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

  it('accepts only the documented archive and pin list filters', async () => {
    const valid = plainToInstance(ListProjectsQueryDto, {
      archived: 'only',
      pinned: 'exclude',
    });
    const invalid = plainToInstance(ListProjectsQueryDto, {
      archived: 'invalid',
      pinned: 'invalid',
    });

    await expect(validate(valid)).resolves.toEqual([]);
    await expect(validate(invalid)).resolves.not.toEqual([]);
  });
});
