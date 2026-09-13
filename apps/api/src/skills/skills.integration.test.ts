/**
 * Skills catalog e2e: a real HTTP consumer (supertest) against the bootstrapped
 * NestJS app, proving the operator catalog inspection surface is authenticated,
 * identical for two owners, and read-only. Requires POSTGRES_URL (the
 * test:integration globalSetup provides one); skipped without it.
 */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import type { Server } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { AppModule } from '../app.module';
import { configureApp } from '../app.setup';
import { CanonicalSearchCoverageService } from '../search/canonical-search-activation.service';
import { cookieOf } from '../testing/support';

const hasDb = !!process.env.POSTGRES_URL;
const d = hasDb ? describe : describe.skip;

d('skills catalog e2e — real HTTP + Postgres', () => {
  let app: INestApplication;
  let http: Server;
  let workingDirectory = '';
  let source = '';
  let previousConfigPath: string | undefined;
  let cookieA = '';
  let cookieB = '';
  const tag = Date.now();

  beforeAll(async () => {
    workingDirectory = mkdtempSync(path.join(tmpdir(), 'llame-skills-e2e-'));
    source = path.join(workingDirectory, 'source');
    for (const name of ['pdf', 'review']) {
      const directory = path.join(source, name);
      mkdirSync(directory, { recursive: true });
      writeFileSync(
        path.join(directory, 'SKILL.md'),
        `---\nname: ${name}\ndescription: The ${name} skill.\n---\n# Instructions\n`,
      );
    }
    const reviewAgents = path.join(source, 'review', 'agents');
    mkdirSync(reviewAgents, { recursive: true });
    writeFileSync(
      path.join(reviewAgents, 'openai.yaml'),
      'policy:\n  allow_implicit_invocation: false\n',
    );
    const broken = path.join(source, 'broken');
    mkdirSync(broken, { recursive: true });
    writeFileSync(
      path.join(broken, 'SKILL.md'),
      '---\nname: broken\n---\n# Missing description\n',
    );

    const configPath = path.join(workingDirectory, 'llame.config.json');
    writeFileSync(
      configPath,
      JSON.stringify({ skills: { directories: [source] } }),
    );
    previousConfigPath = process.env.LLAME_CONFIG_PATH;
    process.env.LLAME_CONFIG_PATH = configPath;

    const mod = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(CanonicalSearchCoverageService)
      .useValue({ assertReady: () => Promise.resolve() })
      .compile();
    app = mod.createNestApplication();
    configureApp(app);
    await app.init();
    http = app.getHttpServer();

    const registered = await Promise.all(
      [`alice.${tag}@example.com`, `bob.${tag}@example.com`].map((email) =>
        request(http)
          .post('/auth/v1/register')
          .send({ email, password: 'password123', name: email }),
      ),
    );
    cookieA = cookieOf(registered[0]);
    cookieB = cookieOf(registered[1]);
  });

  afterAll(async () => {
    await app?.close();
    if (previousConfigPath === undefined) delete process.env.LLAME_CONFIG_PATH;
    else process.env.LLAME_CONFIG_PATH = previousConfigPath;
    rmSync(workingDirectory, { recursive: true, force: true });
  });

  it('refuses an unauthenticated catalog request', async () => {
    expect((await request(http).get('/api/v1/skills')).status).toBe(401);
  });

  it('publishes the operator catalog to an authenticated owner', async () => {
    const response = await request(http)
      .get('/api/v1/skills')
      .set('Cookie', cookieA);
    const body = response.body;

    expect(response.status).toBe(200);
    expect(body.available).toBe(true);
    expect(body.directories).toEqual([source]);
    expect(body.items.map((item: { name: string }) => item.name)).toEqual([
      'broken',
      'pdf',
      'review',
    ]);

    const pdf = body.items.find(
      (item: { name: string }) => item.name === 'pdf',
    );
    const review = body.items.find(
      (item: { name: string }) => item.name === 'review',
    );
    const broken = body.items.find(
      (item: { name: string }) => item.name === 'broken',
    );
    expect(pdf.proactive).toBe(true);
    expect(pdf.available).toBe(true);
    expect(pdf.skillDirectory).toBe(path.join(source, 'pdf'));
    expect(review.proactive).toBe(false);
    expect(broken.available).toBe(false);
    expect(broken.diagnostics).toHaveLength(1);
  });

  it('shows two owners the identical catalog', async () => {
    const [fromA, fromB] = await Promise.all([
      request(http).get('/api/v1/skills').set('Cookie', cookieA),
      request(http).get('/api/v1/skills').set('Cookie', cookieB),
    ]);

    expect(fromA.status).toBe(200);
    expect(fromB.body).toEqual(fromA.body);
  });

  it('exposes no catalog mutation route', async () => {
    const posted = await request(http)
      .post('/api/v1/skills')
      .set('Cookie', cookieA);

    expect(posted.status).toBe(404);
  });
});
