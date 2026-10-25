import type { OpenAPIObject } from '@nestjs/swagger';

import { completeContract } from './openapi-contract';

function document(): OpenAPIObject {
  return {
    openapi: '3.0.0',
    info: { title: 'test', version: '1' },
    paths: {
      '/items': {
        get: {
          responses: {
            '200': {
              description: '',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/ItemResponse' },
                },
              },
            },
          },
        },
        post: {
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/CreateItemDto' },
              },
            },
          },
          responses: {
            '201': { description: '' },
            '400': { description: 'Name taken' },
          },
        },
        patch: {
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/UpdateItemDto' },
              },
            },
          },
          responses: { '200': { description: '' } },
        },
      },
      '/uploads': {
        post: {
          requestBody: {
            required: true,
            content: {
              'multipart/form-data': {
                schema: {
                  type: 'object',
                  required: ['file'],
                  properties: { file: { type: 'string', format: 'binary' } },
                },
              },
            },
          },
          responses: { '201': { description: '' } },
        },
      },
    },
    components: {
      schemas: {
        CreateItemDto: {
          type: 'object',
          required: ['name', 'parts'],
          properties: {
            name: { type: 'string' },
            parts: {
              type: 'array',
              items: { $ref: '#/components/schemas/ItemPartDto' },
            },
          },
        },
        ItemPartDto: {
          type: 'object',
          required: ['text'],
          properties: { text: { type: 'string' } },
        },
        UpdateItemDto: {
          type: 'object',
          properties: { name: { type: 'string' } },
        },
        ItemResponse: {
          type: 'object',
          properties: { name: { type: 'string' } },
        },
      },
    },
  };
}

describe('completeContract', () => {
  const completed = completeContract(document());
  const schemas = completed.components?.schemas ?? {};
  const items = completed.paths['/items'];

  it('closes every schema a request body reaches, nested ones included', () => {
    expect(schemas.CreateItemDto).toMatchObject({
      additionalProperties: false,
    });
    expect(schemas.ItemPartDto).toMatchObject({ additionalProperties: false });
    expect(completed.paths['/uploads'].post?.requestBody).toMatchObject({
      content: {
        'multipart/form-data': { schema: { additionalProperties: false } },
      },
    });
  });

  it('leaves response schemas open', () => {
    expect(schemas.ItemResponse).not.toHaveProperty('additionalProperties');
  });

  it('makes a JSON body optional only when it requires no field', () => {
    expect(items.patch?.requestBody).toMatchObject({ required: false });
    expect(items.post?.requestBody).toMatchObject({ required: true });
  });

  it('documents 400 everywhere and 413 where there is a body, keeping existing entries', () => {
    expect(Object.keys(items.get?.responses ?? {})).toEqual(['200', '400']);
    expect(items.post?.responses['400']).toEqual({ description: 'Name taken' });
    expect(items.post?.responses).toHaveProperty('413');
    expect(items.get?.responses).not.toHaveProperty('413');
  });
});
