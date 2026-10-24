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
  description: 'Everything about the Acme relaunch',
  createdAt: new Date('2026-08-01T00:00:00.000Z'),
  updatedAt: new Date('2026-08-01T00:00:00.000Z'),
  archivedAt: null,
  defaultExecutorId: null,
};

describe('project DTOs', () => {
  it('maps the complete project response without dropping archive state', () => {
    const response = toProjectResponse(project);
    expect(response).toEqual(project);
    // A pass-through that handed the stored row back would leak whatever the
    // schema grows next; the mapper must build its own object.
    expect(response).not.toBe(project);
  });

  it('accepts a description, clears it with an explicit null, and bounds it', async () => {
    const [kept, cleared, tooLong, notText] = await Promise.all([
      validate(plainToInstance(UpdateProjectDto, { description: 'Acme' })),
      validate(plainToInstance(UpdateProjectDto, { description: null })),
      validate(
        plainToInstance(UpdateProjectDto, { description: 'x'.repeat(1001) }),
      ),
      validate(plainToInstance(UpdateProjectDto, { description: 42 })),
    ]);

    expect(kept).toEqual([]);
    // null is a legitimate value here (clear it), not a rejected one — unlike
    // `name`, whose NOT NULL column must reject an explicit null.
    expect(cleared).toEqual([]);
    expect(tooLong).not.toEqual([]);
    expect(notText).not.toEqual([]);
  });

  it('accepts an optional, bounded description on create', async () => {
    const [described, none, tooLong] = await Promise.all([
      validate(
        plainToInstance(CreateProjectDto, { name: 'P', description: 'Acme' }),
      ),
      validate(
        plainToInstance(CreateProjectDto, { name: 'P', description: null }),
      ),
      validate(
        plainToInstance(CreateProjectDto, {
          name: 'P',
          description: 'x'.repeat(1001),
        }),
      ),
    ]);

    expect(described).toEqual([]);
    expect(none).toEqual([]);
    expect(tooLong).not.toEqual([]);
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
  it('accepts, bounds, and clears the default executor', async () => {
    const [set, cleared, omitted, blank, tooLong] = await Promise.all([
      validate(
        plainToInstance(UpdateProjectDto, { defaultExecutorId: 'machine:nas' }),
      ),
      validate(plainToInstance(UpdateProjectDto, { defaultExecutorId: null })),
      validate(plainToInstance(UpdateProjectDto, {})),
      validate(plainToInstance(UpdateProjectDto, { defaultExecutorId: '  ' })),
      validate(
        plainToInstance(UpdateProjectDto, {
          defaultExecutorId: 'x'.repeat(201),
        }),
      ),
    ]);

    expect(set).toEqual([]);
    // null is the documented way to clear it, like `description`.
    expect(cleared).toEqual([]);
    expect(omitted).toEqual([]);
    expect(blank).not.toEqual([]);
    expect(tooLong).not.toEqual([]);
  });
});
