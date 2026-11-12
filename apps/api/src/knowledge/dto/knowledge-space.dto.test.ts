import Ajv from 'ajv';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { ValidationPipe } from '@nestjs/common';
import { z } from 'zod';

import {
  CreateKnowledgeSpaceDto,
  UpdateKnowledgeSpaceDto,
} from './knowledge-space.dto';

const apiNameSchema = z.object({
  properties: z.object({
    name: z.object({ pattern: z.string() }),
  }),
});

const openApiNameSchemas = z
  .object({
    components: z.object({
      schemas: z.object({
        CreateKnowledgeSpaceDto: apiNameSchema,
        UpdateKnowledgeSpaceDto: apiNameSchema,
      }),
    }),
  })
  .parse(
    JSON.parse(readFileSync(join(__dirname, '../../../openapi.json'), 'utf8')),
  );

const createNamePattern =
  openApiNameSchemas.components.schemas.CreateKnowledgeSpaceDto.properties.name
    .pattern;

const updateNamePattern =
  openApiNameSchemas.components.schemas.UpdateKnowledgeSpaceDto.properties.name
    .pattern;

const validateCreateName = new Ajv({ unicodeRegExp: true }).compile({
  type: 'string',
  pattern: createNamePattern,
});

const validateUpdateName = new Ajv({ unicodeRegExp: true }).compile({
  type: 'string',
  pattern: updateNamePattern,
});

const ASTRAL_FORMAT_RANGES: ReadonlyArray<readonly [number, number]> = [
  [0x1_10_bd, 0x1_10_bd],
  [0x1_10_cd, 0x1_10_cd],
  [0x1_34_30, 0x1_34_3f],
  [0x1_bc_a0, 0x1_bc_a3],
  [0x1_d1_73, 0x1_d1_7a],
  [0xe_00_01, 0xe_00_01],
  [0xe_00_20, 0xe_00_7f],
];

const ASTRAL_FORMAT_CHARACTERS = ASTRAL_FORMAT_RANGES.flatMap(([start, end]) =>
  Array.from({ length: end - start + 1 }, (_, index) =>
    String.fromCodePoint(start + index),
  ),
);

async function dtoAcceptsName(name: string): Promise<boolean> {
  try {
    await pipe.transform(
      { name },
      { type: 'body', metatype: CreateKnowledgeSpaceDto, data: '' },
    );

    return true;
  } catch {
    return false;
  }
}

const pipe = new ValidationPipe({
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: true,
});

it('keeps generated name schemas aligned with runtime name validation', async () => {
  expect(updateNamePattern).toBe(createNamePattern);

  const validNames = ['  Personal\u00A0', 'Personal\u000B', '😀'.repeat(100)];

  const invalidNames = [
    '0🏻Ü\u{BB05A}\u{E0028}ÁÃFÙĊhı!\u000B',
    '\u0085Personal',
    '\u001CPersonal',
    '\u001FPersonal',
  ];

  for (const name of validNames) {
    expect(validateCreateName(name)).toBe(true);
    expect(validateUpdateName(name)).toBe(true);
    await expect(dtoAcceptsName(name)).resolves.toBe(true);
  }

  for (const name of invalidNames) {
    expect(validateCreateName(name)).toBe(false);
    expect(validateUpdateName(name)).toBe(false);
    await expect(dtoAcceptsName(name)).resolves.toBe(false);
  }

  for (const formatCharacter of ASTRAL_FORMAT_CHARACTERS) {
    const name = `A${formatCharacter}B`;
    expect(validateCreateName(name)).toBe(false);
    expect(validateUpdateName(name)).toBe(false);
    await expect(dtoAcceptsName(name)).resolves.toBe(false);
  }
});

describe('Knowledge Space DTOs', () => {
  it('trims a valid create name before the controller sees it', async () => {
    const result: unknown = await pipe.transform(
      { name: '  Personal  ' },
      { type: 'body', metatype: CreateKnowledgeSpaceDto, data: '' },
    );

    expect(result).toMatchObject({ name: 'Personal' });
  });

  it('rejects excess create fields and invalid names', async () => {
    await expect(
      pipe.transform(
        { name: 'Personal', ownerUserId: 'attacker' },
        { type: 'body', metatype: CreateKnowledgeSpaceDto, data: '' },
      ),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      pipe.transform(
        { name: '😀'.repeat(101) },
        { type: 'body', metatype: CreateKnowledgeSpaceDto, data: '' },
      ),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('requires a non-empty patch and rejects an explicit null', async () => {
    await expect(
      pipe.transform(
        {},
        { type: 'body', metatype: UpdateKnowledgeSpaceDto, data: '' },
      ),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      pipe.transform(
        { name: null },
        { type: 'body', metatype: UpdateKnowledgeSpaceDto, data: '' },
      ),
    ).rejects.toMatchObject({ status: 400 });
  });
});
