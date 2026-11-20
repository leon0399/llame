/**
 * HTTP-boundary tests for literal Project instructions — save, replace,
 * omission, clear, the 16000-code-point bound before whitespace normalization,
 * archive refusal, owner isolation, and no instruction text in diagnostics.
 *
 * Runs against real Postgres (integration project) as the non-superuser `app`
 * role through the real AppModule, real session authentication, and the real
 * DTO/ValidationPipe path — not a mocked controller echo. Two registered owners
 * prove that every 404 and 409 is answered by the RLS-scoped query.
 *
 * Covers openspec `projects` — "Projects carry literal owner instructions",
 * "Instruction updates use the owner Project resource", and "Project
 * instructions retain owner isolation".
 */

import { type IncomingMessage, Server, type ServerResponse } from 'node:http';

import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import postgres, { type Sql } from 'postgres';
import request from 'supertest';
import { z } from 'zod';

import { AppModule } from '../app.module';
import { configureApp } from '../app.setup';
import { BUILT_IN_DEFAULTS } from '../instance-config/llame-config';
import { InstanceConfigService } from '../instance-config/instance-config.service';
import { CanonicalSearchCoverageService } from '../search/canonical-search-activation.service';
import { cookieOf, expectRegisteredUserId } from '../testing/support';

vi.setConfig({ testTimeout: 60_000 });

const TEST_DB_URL = process.env['TEST_DATABASE_URL'];

if (!TEST_DB_URL) {
  throw new Error(
    'project-instructions.integration.test.ts requires TEST_DATABASE_URL; run it with `pnpm --filter api test:integration`.',
  );
}

const projectSchema = z.looseObject({
  id: z.guid(),
  name: z.string(),
  instructions: z.string().nullable(),
  archivedAt: z.string().nullable(),
});

type HttpServer = Server<typeof IncomingMessage, typeof ServerResponse>;

function isHttpServer(value: unknown): value is HttpServer {
  return value instanceof Server;
}

type Harness = {
  readonly app: INestApplication;
  readonly http: HttpServer;
  readonly cookie: string;
  readonly userId: string;
};

type UpdateProjectBody = {
  readonly name?: string;
  readonly instructions?: string | null;
  readonly archived?: boolean;
};

async function boot(): Promise<Harness> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(CanonicalSearchCoverageService)
    .useValue({ assertReady: () => Promise.resolve() })
    .overrideProvider(InstanceConfigService)
    .useValue({ config: BUILT_IN_DEFAULTS })
    .compile();

  const app = moduleRef.createNestApplication();
  configureApp(app);
  await app.listen(0);
  const server: unknown = app.getHttpServer();

  if (!isHttpServer(server)) {
    throw new Error('Expected Nest to expose a Node HTTP server');
  }

  const registered = await request(server)
    .post('/auth/v1/register')
    .send({
      email: `project-instructions-${crypto.randomUUID()}@test.com`,
      password: 'password123',
      name: 'Project instructions owner',
    });

  const body: unknown = registered.body;
  expectRegisteredUserId(body);

  return {
    app,
    http: server,
    cookie: cookieOf(registered),
    userId: body.user.id,
  };
}

describe('project instructions over HTTP', () => {
  let owner: Harness;
  let other: Harness;
  let sql: Sql;
  let projectId: string;

  const patch = (harness: Harness, id: string, body: UpdateProjectBody) =>
    request(harness.http)
      .patch(`/api/v1/projects/${id}`)
      .set('Cookie', harness.cookie)
      .send(body);

  const get = (harness: Harness, id: string) =>
    request(harness.http)
      .get(`/api/v1/projects/${id}`)
      .set('Cookie', harness.cookie);

  async function storedInstructions(harness: Harness, id: string) {
    return projectSchema.parse((await get(harness, id).expect(200)).body)
      .instructions;
  }

  beforeAll(async () => {
    [owner, other] = await Promise.all([boot(), boot()]);
    sql = postgres(TEST_DB_URL, {
      max: 2,
      ssl: /sslmode=require/.test(TEST_DB_URL) ? 'require' : false,
    });

    const created = await request(owner.http)
      .post('/api/v1/projects')
      .set('Cookie', owner.cookie)
      .send({ name: 'Instructions project' })
      .expect(201);

    projectId = projectSchema.parse(created.body).id;
  });

  afterAll(async () => {
    await owner?.app.close();
    await other?.app.close();

    if (sql) {
      // Users cascade to sessions and projects (and their rows); deleting the
      // two fixture owners is the whole deterministic cleanup.
      await sql`DELETE FROM users WHERE id IN (${owner?.userId ?? ''}, ${other?.userId ?? ''})`;
      await sql.end();
    }
  });

  it('exposes instructions as a nullable response field, absent on a new Project', async () => {
    const created = projectSchema.parse(
      (
        await request(owner.http)
          .post('/api/v1/projects')
          .set('Cookie', owner.cookie)
          .send({ name: 'Fresh project' })
          .expect(201)
      ).body,
    );

    expect(created.instructions).toBeNull();

    // The explicit projection keeps the field on every read, so a client can
    // distinguish "absent" from "not returned".
    const read = projectSchema.parse(
      (await get(owner, created.id).expect(200)).body,
    );

    expect(read.instructions).toBeNull();

    const list = z
      .array(projectSchema)
      .parse(
        (
          await request(owner.http)
            .get('/api/v1/projects')
            .set('Cookie', owner.cookie)
            .expect(200)
        ).body,
      );

    expect(list.find((row) => row.id === created.id)?.instructions).toBeNull();

    await request(owner.http)
      .delete(`/api/v1/projects/${created.id}`)
      .set('Cookie', owner.cookie)
      .expect(204);
  });

  it('saves, replaces, omits, and clears literal instructions', async () => {
    const literal = '  Read @policy.md before edits.\nNever run $review.\t';

    const saved = projectSchema.parse(
      (await patch(owner, projectId, { instructions: literal }).expect(200))
        .body,
    );

    // Literal text: surrounding whitespace, line breaks, and import markers
    // are preserved exactly — nothing resolves the file or the skill.
    expect(saved.instructions).toBe(literal);
    expect(await storedInstructions(owner, projectId)).toBe(literal);

    // Omission preserves: a patch naming only the name leaves the text alone.
    const renamed = projectSchema.parse(
      (await patch(owner, projectId, { name: 'Renamed project' }).expect(200))
        .body,
    );

    expect(renamed.name).toBe('Renamed project');
    expect(renamed.instructions).toBe(literal);
    expect(await storedInstructions(owner, projectId)).toBe(literal);

    const replaced = projectSchema.parse(
      (
        await patch(owner, projectId, {
          instructions: 'Prefer the web package.',
        }).expect(200)
      ).body,
    );

    expect(replaced.instructions).toBe('Prefer the web package.');

    const cleared = projectSchema.parse(
      (await patch(owner, projectId, { instructions: null }).expect(200)).body,
    );

    expect(cleared.instructions).toBeNull();
    expect(await storedInstructions(owner, projectId)).toBeNull();
  });

  it('bounds instructions by code points before whitespace normalization', async () => {
    const marker = 'EXISTING-INSTRUCTION-TEXT';
    await patch(owner, projectId, { instructions: marker }).expect(200);

    // Oversized whitespace is refused BEFORE the service could read it as
    // "clear": the stored value survives a 16001-space payload.
    const overlongSpaces = await patch(owner, projectId, {
      instructions: ' '.repeat(16_001),
    }).expect(400);

    // The error names the field and bound, never echoing the 16001-space run.
    expect(JSON.stringify(overlongSpaces.body)).not.toContain(' '.repeat(100));
    expect(await storedInstructions(owner, projectId)).toBe(marker);

    // In-bound whitespace does clear it.
    const inBoundSpaces = projectSchema.parse(
      (
        await patch(owner, projectId, {
          instructions: ' '.repeat(16_000),
        }).expect(200)
      ).body,
    );

    expect(inBoundSpaces.instructions).toBeNull();

    // The exact maximum is accepted and stored as given.
    const maxBmp = 'x'.repeat(16_000);

    const savedBmp = projectSchema.parse(
      (await patch(owner, projectId, { instructions: maxBmp }).expect(200))
        .body,
    );

    expect(savedBmp.instructions).toBe(maxBmp);

    // One code point over fails and changes nothing.
    const secret = 'SUBMITTED-INSTRUCTION-TEXT-MUST-NOT-LEAK';

    const overBmp = await patch(owner, projectId, {
      instructions: secret + 'x'.repeat(16_001 - secret.length),
    }).expect(400);

    expect(JSON.stringify(overBmp.body)).not.toContain(secret);
    expect(await storedInstructions(owner, projectId)).toBe(maxBmp);

    // Non-BMP characters count once each, not once per UTF-16 code unit: a
    // code-unit bound would have refused this valid maximum.
    const maxNonBmp = '\u{1F600}'.repeat(16_000);

    const savedNonBmp = projectSchema.parse(
      (await patch(owner, projectId, { instructions: maxNonBmp }).expect(200))
        .body,
    );

    expect(savedNonBmp.instructions).toBe(maxNonBmp);

    const overNonBmp = await patch(owner, projectId, {
      instructions: '\u{1F600}'.repeat(16_001),
    }).expect(400);

    expect(JSON.stringify(overNonBmp.body)).not.toContain('\u{1F600}');
    expect(await storedInstructions(owner, projectId)).toBe(maxNonBmp);

    // Presentation variation selectors are their own code points: the
    // installed validator folds each `a\uFE0F` pair to one character and
    // would admit these 32000 code points. The refusal leaves the stored
    // maximum untouched and does not echo the submitted payload.
    const overPresentation = await patch(owner, projectId, {
      instructions: 'a\uFE0F'.repeat(16_000),
    }).expect(400);

    expect(JSON.stringify(overPresentation.body)).not.toContain(
      'a\uFE0F'.repeat(2),
    );
    expect(await storedInstructions(owner, projectId)).toBe(maxNonBmp);
  });

  it('rejects non-string instructions and POST-provided instructions without echoing text', async () => {
    const marker = 'KEEP-THIS-INSTRUCTION';
    await patch(owner, projectId, { instructions: marker }).expect(200);

    // Deliberately invalid shape at the untyped HTTP boundary: the helper is
    // typed for valid updates, so the non-string case goes through supertest
    // directly. The DTO must reject it before anything reaches the service.
    const notText = await request(owner.http)
      .patch(`/api/v1/projects/${projectId}`)
      .set('Cookie', owner.cookie)
      .send({ instructions: { text: 'objects are not instruction text' } })
      .expect(400);

    expect(JSON.stringify(notText.body)).not.toContain(marker);
    expect(JSON.stringify(notText.body)).not.toContain(
      'objects are not instruction text',
    );
    expect(await storedInstructions(owner, projectId)).toBe(marker);

    // Instructions are a PATCH-only field: creation does not accept them, and
    // the global whitelist turns an attempt into a 400 instead of a silent drop.
    const postSecret = 'POST-MUST-NOT-ACCEPT-INSTRUCTIONS';

    const created = await request(owner.http)
      .post('/api/v1/projects')
      .set('Cookie', owner.cookie)
      .send({ name: 'No instructions on create', instructions: postSecret })
      .expect(400);

    expect(JSON.stringify(created.body)).not.toContain(postSecret);
  });

  it('answers 401 without a session and 404 for a foreign owner, changing nothing', async () => {
    const marker = 'OWNER-PRIVATE-INSTRUCTION';
    await patch(owner, projectId, { instructions: marker }).expect(200);

    await request(owner.http)
      .patch(`/api/v1/projects/${projectId}`)
      .send({ instructions: 'unauthenticated write' })
      .expect(401);

    const foreign = await patch(other, projectId, {
      instructions: 'foreign write',
    }).expect(404);

    // The 404 body names no instruction text and does not confirm the value.
    expect(JSON.stringify(foreign.body)).not.toContain(marker);
    expect(JSON.stringify(foreign.body)).not.toContain('foreign write');
    expect(await storedInstructions(owner, projectId)).toBe(marker);

    // A foreign read is the same not-found answer, not a partial row.
    const foreignRead = await get(other, projectId).expect(404);
    expect(JSON.stringify(foreignRead.body)).not.toContain(marker);
  });

  it('keeps instructions readable on an archived Project but refuses edits and clears with 409', async () => {
    const created = projectSchema.parse(
      (
        await request(owner.http)
          .post('/api/v1/projects')
          .set('Cookie', owner.cookie)
          .send({ name: 'Archived instructions' })
          .expect(201)
      ).body,
    );

    const frozen = 'Archived project guidance.';
    await patch(owner, created.id, { instructions: frozen }).expect(200);

    const archived = projectSchema.parse(
      (await patch(owner, created.id, { archived: true }).expect(200)).body,
    );

    expect(archived.archivedAt).toEqual(expect.any(String));
    expect(archived.instructions).toBe(frozen);

    const edit = await patch(owner, created.id, {
      instructions: 'changed while archived',
    }).expect(409);

    const clear = await patch(owner, created.id, {
      instructions: null,
    }).expect(409);

    // In-bound whitespace would clear an active Project; on an archived one it
    // is still an instruction edit and must be refused, not silently cleared.
    const whitespaceClear = await patch(owner, created.id, {
      instructions: ' '.repeat(16_000),
    }).expect(409);

    for (const response of [edit, clear, whitespaceClear]) {
      expect(JSON.stringify(response.body)).not.toContain(frozen);
      expect(JSON.stringify(response.body)).not.toContain(
        'changed while archived',
      );
    }

    // The saved instructions remain readable; only mutation is refused.
    expect(await storedInstructions(owner, created.id)).toBe(frozen);

    await request(owner.http)
      .delete(`/api/v1/projects/${created.id}`)
      .set('Cookie', owner.cookie)
      .expect(204);
  });
});
