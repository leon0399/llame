import { Test } from '@nestjs/testing';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { z } from 'zod';

import { ChatJobsController } from './chat-jobs.controller';
import { ChatJobsService } from './chat-jobs.service';

const OUTPUT_PATH = '/api/v1/chats/{chatId}/jobs/{jobId}/output';

const unionSchema = z.object({
  oneOf: z.array(z.object({ $ref: z.string() })),
  discriminator: z.object({
    propertyName: z.string(),
    mapping: z.record(z.string(), z.string()),
  }),
});

const statusSchema = z.object({
  properties: z.object({ status: z.object({ enum: z.array(z.string()) }) }),
  required: z.array(z.string()),
});

/** The document the controller publishes, built from its decorators alone. */
async function documentOf() {
  const moduleRef = await Test.createTestingModule({
    controllers: [ChatJobsController],
    providers: [{ provide: ChatJobsService, useValue: {} }],
  }).compile();

  const app = moduleRef.createNestApplication();

  await app.init();

  const document = SwaggerModule.createDocument(
    app,
    new DocumentBuilder().build(),
  );

  await app.close();

  return document;
}

describe('ChatJobsController OpenAPI contract', () => {
  // The web client narrows the output on `status`; each tag must name the
  // branch whose own `status` enum holds that tag.
  it('publishes the job output as a union discriminated by status', async () => {
    const document = await documentOf();
    const schemas = document.components?.schemas ?? {};

    const union = z
      .object({
        content: z.object({
          'application/json': z.object({ schema: unionSchema }),
        }),
      })
      .parse(document.paths[OUTPUT_PATH]?.get?.responses['200']).content[
      'application/json'
    ].schema;

    expect(union.discriminator.propertyName).toBe('status');
    expect(Object.keys(union.discriminator.mapping).sort()).toEqual([
      'stored',
      'unavailable',
    ]);
    expect(union.oneOf.map(({ $ref }) => $ref).sort()).toEqual(
      Object.values(union.discriminator.mapping).sort(),
    );

    for (const [tag, ref] of Object.entries(union.discriminator.mapping)) {
      const branch = statusSchema.parse(
        schemas[ref.replace('#/components/schemas/', '')],
      );

      expect(branch.properties.status.enum).toEqual([tag]);
      expect(branch.required).toContain('status');
    }
  });
});
