import { Test } from '@nestjs/testing';
import { type INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from './app.module';
import { configureApp } from './app.setup';
import { McpRuntimeService } from './mcp/mcp-runtime.service';
import { DYNAMIC_TOOL_EXECUTOR_RESOLVER } from './runs/snapshot-tool-execution';

describe('AppController — liveness probe', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const mod = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = mod.createNestApplication();
    configureApp(app);
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
  });

  it('GET / returns 200 with the expected body', async () => {
    const res = await request(app.getHttpServer() as import('http').Server).get(
      '/',
    );
    expect(res.status).toBe(200);
    expect(res.text).toBe('Hello World!');
  });

  it('shares one inert MCP runtime between HTTP turn binding and co-located execution', () => {
    const runtime = app.get(McpRuntimeService);

    expect(app.get(DYNAMIC_TOOL_EXECUTOR_RESOLVER)).toBe(runtime);
    expect(runtime.snapshotCandidates(new Set(['mcp__web__search']))).toEqual(
      [],
    );
  });
});
