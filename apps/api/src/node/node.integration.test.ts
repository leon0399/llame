/** Real Nest session guard + HTTP + Postgres owner isolation. Never substitutes a protocol fixture for the API. */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { isRecord, isString } from '@workspace/runtime-safety';
import { NODE_REQUEST_PATH, NODE_VERSION_HEADER, NODE_PRINCIPAL_HEADER } from '@workspace/node-protocol';
import { AppModule } from '../app.module';
import { configureApp } from '../app.setup';
import { BUILT_IN_DEFAULTS } from '../instance-config/llame-config';
import { InstanceConfigService } from '../instance-config/instance-config.service';
import { cookieOf, expectRegisteredUserId } from '../testing/support';

if (!process.env.POSTGRES_URL) throw new Error('Node API integration requires the repository integration database harness.');

describe('Node HTTP adapter through the real session and tenant boundaries', () => {
  let app: INestApplication<import('http').Server>;
  let http: import('http').Server;
  let root = '';
  let owner = { cookie: '', userId: '' };
  let other = { cookie: '', userId: '' };
  let space = '';
  async function register(name: string) {
    const response = await request(http).post('/auth/v1/register').send({ email: `${name}-${randomUUID()}@test.com`, password: 'password123', name }).expect(201);
    const body: unknown = response.body; expectRegisteredUserId(body);
    return { cookie: cookieOf(response), userId: body.user.id };
  }
  function query(account: typeof owner, method: string, params: Record<string, unknown> = {}, expected = account.userId) {
    return request(http).post(NODE_REQUEST_PATH).set('Cookie', account.cookie)
      .set(NODE_VERSION_HEADER, '1').set(NODE_PRINCIPAL_HEADER, expected)
      .send({ jsonrpc: '2.0', id: 'node-test', method, params });
  }
  beforeAll(async () => {
    root = mkdtempSync(join(tmpdir(), 'llame-node-api-'));
    const module = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(InstanceConfigService).useValue({ config: {
      ...BUILT_IN_DEFAULTS, knowledge: { root }, tools: { ...BUILT_IN_DEFAULTS.tools, allowed: ['knowledge_search', 'knowledge_read'] },
    } }).compile();
    app = module.createNestApplication(); configureApp(app); await app.init(); http = app.getHttpServer();
    owner = await register('node-owner'); other = await register('node-other');
    const result = await request(http).post('/api/v1/knowledge-spaces').set('Cookie', owner.cookie).send({ name: 'Node notes' }).expect(201);
    const body: unknown = result.body; if (!isRecord(body) || !isString(body.id)) throw new Error('Missing provisioned Knowledge Space');
    space = body.id; writeFileSync(join(root, space, 'notes.md'), '# Owner note\nprivate canary');
  });
  afterAll(async () => { await app?.close(); if (root) rmSync(root, { recursive: true, force: true }); });

  it('requires a real session before Node discovery or execution admission', async () => {
    await request(http).post(NODE_REQUEST_PATH).send({ jsonrpc: '2.0', id: 'no-session', method: 'core.describe' }).expect(401);
    await request(http).post('/api/v1/runs').send({}).expect(401);
  });
  it('reports actual session identity and enabled canonical capabilities without inventing enrollment', async () => {
    const response = await query(owner, 'core.describe').expect(200);
    expect(response.body).toMatchObject({ result: { kind: 'shared-instance', nodeId: null, principal: { id: owner.userId }, synchronization: false, enrollment: false,
      methods: ['core.describe', 'realm.knowledge.search', 'realm.knowledge.read'] } });
  });
  it('reads the real owner file but cannot distinguish another owner’s ID from a missing resource', async () => {
    const params = { knowledgeSpaceId: space, path: 'notes.md' };
    const mine = await query(owner, 'realm.knowledge.read', params).expect(200);
    expect(mine.body).toMatchObject({ result: { data: { status: 'success' } } }); expect(JSON.stringify(mine.body)).toContain('private canary');
    const foreign = await query(other, 'realm.knowledge.read', params).expect(200);
    const missing = await query(other, 'realm.knowledge.read', { ...params, knowledgeSpaceId: randomUUID() }).expect(200);
    expect(foreign.body).toEqual(missing.body); expect(JSON.stringify(foreign.body)).not.toContain('private canary');
  });
  it('rejects identity substitution and local admin routing even with a valid session', async () => {
    const mismatch = await query(other, 'core.describe', {}, owner.userId).expect(200); expect(mismatch.body).toHaveProperty('error');
    const injection = await query(other, 'realm.knowledge.read', { knowledgeSpaceId: space, path: 'notes.md', userId: owner.userId }).expect(200);
    expect(injection.body).toHaveProperty('error');
    const admin = await query(owner, 'admin.recover').expect(200); expect(admin.body).toHaveProperty('error');
  });
});
