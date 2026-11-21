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
  instructions: null,
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

  it('passes literal instructions through the response without resolving them', () => {
    const literal = '  Follow @policy.md and $review — do not activate them.  ';

    const response = toProjectResponse({ ...project, instructions: literal });

    // Byte-for-byte, surrounding whitespace included: the mapper is a
    // projection, not a normalizer, and import markers stay inert text.
    expect(response.instructions).toBe(literal);
  });

  it('accepts, bounds before normalization, and clears instructions', async () => {
    const [
      omitted,
      cleared,
      literal,
      blank,
      maxBmp,
      overBmp,
      maxNonBmp,
      overNonBmp,
      notText,
    ] = await Promise.all([
      // Omission is the "leave unchanged" signal — valid, not a clear.
      validate(plainToInstance(UpdateProjectDto, {})),
      // null is the documented way to clear the nullable column.
      validate(plainToInstance(UpdateProjectDto, { instructions: null })),
      // Nonblank text is stored exactly, surrounding whitespace included.
      validate(
        plainToInstance(UpdateProjectDto, {
          instructions: '  add @policy.md, skip $review  ',
        }),
      ),
      // All-whitespace is only cleared later, by the service; the DTO
      // accepts it so the 16000 bound can decide oversized input first.
      validate(plainToInstance(UpdateProjectDto, { instructions: ' \t\n ' })),
      validate(
        plainToInstance(UpdateProjectDto, {
          instructions: 'x'.repeat(16_000),
        }),
      ),
      validate(
        plainToInstance(UpdateProjectDto, {
          instructions: 'x'.repeat(16_001),
        }),
      ),
      // Non-BMP characters count as one code point each, not two UTF-16
      // units; a code-unit count would reject this valid maximum.
      validate(
        plainToInstance(UpdateProjectDto, {
          instructions: '\u{1F600}'.repeat(16_000),
        }),
      ),
      validate(
        plainToInstance(UpdateProjectDto, {
          instructions: '\u{1F600}'.repeat(16_001),
        }),
      ),
      validate(plainToInstance(UpdateProjectDto, { instructions: 42 })),
    ]);

    expect(omitted).toEqual([]);
    expect(cleared).toEqual([]);
    expect(literal).toEqual([]);
    expect(blank).toEqual([]);
    expect(maxBmp).toEqual([]);
    expect(maxNonBmp).toEqual([]);
    expect(overBmp).not.toEqual([]);
    expect(overNonBmp).not.toEqual([]);
    expect(notText).not.toEqual([]);
  });

  it.each([
    { label: 'FE0E', selector: '\uFE0E' },
    { label: 'FE0F', selector: '\uFE0F' },
  ])(
    'counts $label variation-selector pairs as two code points each',
    async ({ selector }) => {
      const pair = `a${selector}`;

      const [atBound, oneOver, doubleBound] = await Promise.all([
        // 8000 pairs = 16000 code points: exactly the approved maximum.
        validate(
          plainToInstance(UpdateProjectDto, {
            instructions: pair.repeat(8000),
          }),
        ),
        // 8000 pairs plus one `a` = 16001 code points. The installed
        // validator folds each variation sequence to one character, which
        // would count this payload as 8001 and accept it.
        validate(
          plainToInstance(UpdateProjectDto, {
            instructions: pair.repeat(8000) + 'a',
          }),
        ),
        // 16000 pairs = 32000 code points; folding must not bring it back
        // under the bound.
        validate(
          plainToInstance(UpdateProjectDto, {
            instructions: pair.repeat(16_000),
          }),
        ),
      ]);

      expect(atBound).toEqual([]);
      expect(oneOver).not.toEqual([]);
      expect(doubleBound).not.toEqual([]);
    },
  );

  it('bounds instructions by code points, not grapheme clusters, including a trailing newline', async () => {
    // An astral base plus a combining mark is two code points, three UTF-16
    // units, and one grapheme cluster. A code-unit count would reject the
    // 8000-cluster payload as 24000 units; a grapheme count would accept the
    // 8001-cluster payload as 8001. The code-point contract accepts the first
    // and refuses the second.
    const [combinedAtBound, combinedOneOver, newlineAtBound, newlineOneOver] =
      await Promise.all([
        validate(
          plainToInstance(UpdateProjectDto, {
            instructions: '\u{1F600}\u0301'.repeat(8000),
          }),
        ),
        validate(
          plainToInstance(UpdateProjectDto, {
            instructions: '\u{1F600}\u0301'.repeat(8001),
          }),
        ),
        // Counting happens before normalization: a trailing newline is a
        // code point, so 15999 `x` plus it are exactly 16000...
        validate(
          plainToInstance(UpdateProjectDto, {
            instructions: 'x'.repeat(15_999) + '\n',
          }),
        ),
        // ...and 16000 `x` plus it are 16001, refused rather than trimmed
        // down to an in-bound value.
        validate(
          plainToInstance(UpdateProjectDto, {
            instructions: 'x'.repeat(16_000) + '\n',
          }),
        ),
      ]);

    expect(combinedAtBound).toEqual([]);
    expect(combinedOneOver).not.toEqual([]);
    expect(newlineAtBound).toEqual([]);
    expect(newlineOneOver).not.toEqual([]);
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
      validate(plainToInstance(UpdateProjectDto, { defaultExecutorId: 'nas' })),
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
