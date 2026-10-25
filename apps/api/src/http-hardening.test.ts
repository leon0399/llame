import { Controller, Get, Patch } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { setupOpenApi } from './app.setup';
import { rejectUndeclaredMethods, secureResponses } from './http-hardening';

@Controller('items')
class ItemsController {
  @Get('search')
  search() {
    return { found: [] };
  }

  @Get(':id')
  read() {
    return { id: 'read' };
  }

  @Patch(':id')
  update() {
    return { id: 'updated' };
  }
}

describe('HTTP hardening', () => {
  let app: NestExpressApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [ItemsController],
    }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>({
      logger: false,
    });
    // The order main.ts uses: headers before any route, Swagger UI included.
    secureResponses(app);
    app.use(rejectUndeclaredMethods(setupOpenApi(app)));
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('answers an undeclared method with 405 and the allowed methods', async () => {
    const response = await request(app.getHttpServer())
      .put('/items/abc')
      .expect(405);

    expect(response.headers.allow).toBe('GET, PATCH, HEAD');
    expect(response.body).toEqual({
      statusCode: 405,
      error: 'Method Not Allowed',
      message: 'PUT is not allowed on this path.',
    });
  });

  it('judges a literal path by its own template, not the parameter one it also matches', async () => {
    const response = await request(app.getHttpServer())
      .patch('/items/search')
      .expect(405);

    expect(response.headers.allow).toBe('GET, HEAD');
    await request(app.getHttpServer())
      .get('/items/search')
      .expect(200, { found: [] });
    await request(app.getHttpServer())
      .patch('/items/abc')
      .expect(200, { id: 'updated' });
  });

  it('leaves paths outside the document to the router', async () => {
    await request(app.getHttpServer()).put('/nowhere').expect(404);
  });

  it('sends hardening headers and no framework banner', async () => {
    const response = await request(app.getHttpServer())
      .get('/items/abc')
      .expect(200);

    expect(response.headers['x-powered-by']).toBeUndefined();
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['x-frame-options']).toBe('DENY');
    expect(response.headers['content-security-policy']).toBe(
      "default-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
    );
  });

  it('lets the Swagger UI page load its scripts', async () => {
    const response = await request(app.getHttpServer())
      .get('/docs')
      .expect(200);

    expect(response.headers['content-security-policy']).toBe(
      "frame-ancestors 'none'",
    );
  });
});
