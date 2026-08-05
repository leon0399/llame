import { Test } from '@nestjs/testing';
import { type INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from './app.module';
import { configureApp } from './app.setup';

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
});
