import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';

const HTTP_METHODS = ['delete', 'get', 'patch', 'post', 'put'] as const;

const schemaObjectSchema = z
  .object({
    discriminator: z.unknown().optional(),
    enum: z.array(z.unknown()).optional(),
    items: z.unknown().optional(),
    nullable: z.boolean().optional(),
    oneOf: z.array(z.unknown()).optional(),
    properties: z.record(z.string(), z.unknown()).optional(),
    required: z.array(z.string()).optional(),
    type: z.string().optional(),
  })
  .passthrough();

const responseObjectSchema = z
  .object({
    $ref: z.string().optional(),
    content: z
      .record(z.string(), z.object({ schema: z.unknown().optional() }))
      .optional(),
  })
  .passthrough();

const referenceObjectSchema = z.object({ $ref: z.string() });

const pinnedItemSchema = z
  .object({
    discriminator: z.object({
      mapping: z.object({
        chat: z.literal('#/components/schemas/ChatPinnedItemResponse'),
        project: z.literal('#/components/schemas/ProjectPinnedItemResponse'),
      }),
      propertyName: z.literal('itemType'),
    }),
    oneOf: z.array(referenceObjectSchema),
  })
  .passthrough();

const pinnedListSchema = z.object({
  items: pinnedItemSchema,
  type: z.literal('array'),
});

const operationObjectSchema = z
  .object({
    operationId: z.string().optional(),
    responses: z.record(z.string(), responseObjectSchema),
    tags: z.array(z.string()).optional(),
  })
  .passthrough();

const pathItemObjectSchema = z
  .object({
    delete: operationObjectSchema.optional(),
    get: operationObjectSchema.optional(),
    patch: operationObjectSchema.optional(),
    post: operationObjectSchema.optional(),
    put: operationObjectSchema.optional(),
  })
  .passthrough();

const openApiObjectSchema = z.object({
  components: z
    .object({ schemas: z.record(z.string(), schemaObjectSchema).optional() })
    .optional(),
  paths: z.record(z.string(), pathItemObjectSchema),
});

const rawDocument: unknown = JSON.parse(
  readFileSync(join(__dirname, '../openapi.json'), 'utf8'),
);
const document = openApiObjectSchema.parse(rawDocument);

const EXPECTED_OPERATION_IDS = [
  'changeOrgUnitMembershipRole',
  'createChatMessage',
  'createChildOrgUnit',
  'createKnowledgeSpace',
  'createProject',
  'createRootOrgUnit',
  'deleteChat',
  'deleteOrgUnit',
  'deleteProject',
  'forkChat',
  'forkSharedChat',
  'getChat',
  'getChatMessages',
  'getCurrentSession',
  'getCurrentUser',
  'getHealth',
  'getKnowledgeSpace',
  'getMemory',
  'getMyOrgUnitEffectiveRole',
  'getOrgUnit',
  'getPersonalization',
  'getProject',
  'getRun',
  'getRunContextReceipt',
  'getSharedChat',
  'grantOrgUnitMembership',
  'listActiveRuns',
  'listChats',
  'listKnowledgeSpaces',
  'listModels',
  'listOrgUnitMemberships',
  'listOrgUnits',
  'listPins',
  'listProjects',
  'listSessions',
  'loginUser',
  'logoutUser',
  'pinItem',
  'registerUser',
  'renameKnowledgeSpace',
  'reorderPins',
  'resumeChatStream',
  'revokeOrgUnitMembership',
  'revokeSession',
  'revokeSessions',
  'searchChats',
  'streamRunEvents',
  'unpinItem',
  'updateChat',
  'updateMemory',
  'updateOrgUnit',
  'updatePersonalization',
  'updateProject',
  'updateRun',
] as const;

const EXPECTED_ORG_UNIT_CONFLICT_CODES = [
  'CONCURRENT_TREE_CHANGE',
  'DUPLICATE_MEMBERSHIP',
  'HAS_CHILDREN',
  'LAST_OWNER',
] as const;

type OperationEntry = {
  method: (typeof HTTP_METHODS)[number];
  path: string;
  operation: z.infer<typeof operationObjectSchema>;
};

function operations(): Array<OperationEntry> {
  return Object.entries(document.paths).flatMap(([path, pathItem]) =>
    HTTP_METHODS.flatMap((method) => {
      const operation = pathItem[method];
      return operation ? [{ method, path, operation }] : [];
    }),
  );
}

function operation(method: OperationEntry['method'], path: string) {
  const match = operations().find(
    (entry) => entry.method === method && entry.path === path,
  );
  if (!match) {
    throw new Error(`Missing operation ${method.toUpperCase()} ${path}`);
  }
  return match.operation;
}

function response(
  method: OperationEntry['method'],
  path: string,
  status: string,
): z.infer<typeof responseObjectSchema> {
  const result = operation(method, path).responses[status];
  if (!result) {
    throw new Error(
      `Missing response ${method.toUpperCase()} ${path} ${status}`,
    );
  }
  return result;
}

function pinnedItemResponseSchema(
  method: OperationEntry['method'],
  path: string,
): z.infer<typeof pinnedItemSchema> {
  const schema = response(method, path, '200').content?.['application/json']
    ?.schema;
  return pinnedItemSchema.parse(
    method === 'get' ? pinnedListSchema.parse(schema).items : schema,
  );
}

describe('committed OpenAPI contract', () => {
  it('uses an intentional globally unique set of domain operation IDs', () => {
    const ids = operations().map(({ operation }) =>
      z.string().parse(operation.operationId),
    );

    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.some((id) => /Controller_/.test(id))).toBe(false);
    expect(ids.toSorted((a, b) => a.localeCompare(b))).toEqual(
      EXPECTED_OPERATION_IDS,
    );
  });

  it.each([
    ['get', '/api/v1/chats/{id}/stream', 'chats'],
    ['post', '/api/v1/chats/{id}/messages', 'chats'],
    ['get', '/api/v1/runs/{id}/events', 'runs'],
  ] as const)(
    '%s %s retains its domain tag and is tagged streaming',
    (method, path, domainTag) => {
      expect(operation(method, path).tags).toEqual([domainTag, 'streaming']);
    },
  );

  it('models pinned items as correlated branches across list and pin responses', () => {
    const pinnedSchemas = [
      pinnedItemResponseSchema('get', '/api/v1/pins'),
      pinnedItemResponseSchema('put', '/api/v1/pins/{itemType}/{itemId}'),
    ];
    const expectedPinnedSchema = {
      oneOf: [
        { $ref: '#/components/schemas/ChatPinnedItemResponse' },
        { $ref: '#/components/schemas/ProjectPinnedItemResponse' },
      ],
      discriminator: {
        propertyName: 'itemType',
        mapping: {
          chat: '#/components/schemas/ChatPinnedItemResponse',
          project: '#/components/schemas/ProjectPinnedItemResponse',
        },
      },
    };

    expect(pinnedSchemas).toEqual([
      expect.objectContaining(expectedPinnedSchema),
      expect.objectContaining(expectedPinnedSchema),
    ]);

    const schemas = document.components?.schemas ?? {};
    expect(schemas.ChatPinnedItemResponse).toMatchObject({
      required: ['itemType', 'itemId', 'pinnedAt', 'item'],
      properties: {
        itemType: { type: 'string', enum: ['chat'] },
        item: { $ref: '#/components/schemas/ChatRefCard' },
      },
    });
    expect(schemas.ProjectPinnedItemResponse).toMatchObject({
      required: ['itemType', 'itemId', 'pinnedAt', 'item'],
      properties: {
        itemType: { type: 'string', enum: ['project'] },
        item: { $ref: '#/components/schemas/ProjectRefCard' },
      },
    });
  });

  it('keeps directRole required and nullable', () => {
    const schema = schemaObjectSchema.parse(
      document.components?.schemas?.OrgUnitResponse,
    );
    const properties = z
      .record(z.string(), z.unknown())
      .parse(schema.properties);
    const directRole = schemaObjectSchema.parse(properties.directRole);

    expect(schema.required).toContain('directRole');
    expect(directRole.nullable).toBe(true);
  });

  it.each([
    ['preferredName', 255],
    ['about', 8000],
    ['responsePreferences', 8000],
  ] as const)(
    'documents nullable personalization input %s as an optional string',
    (property, maxLength) => {
      const schema = schemaObjectSchema.parse(
        document.components?.schemas?.UpdatePersonalizationDto,
      );
      const properties = z
        .record(z.string(), z.unknown())
        .parse(schema.properties);
      const field = schemaObjectSchema.parse(properties[property]);

      expect(schema.required ?? []).not.toContain(property);
      expect(field).toMatchObject({
        type: 'string',
        nullable: true,
        maxLength,
      });
    },
  );

  it('keeps the complete sorted organization conflict code enum', () => {
    const schema = schemaObjectSchema.parse(
      document.components?.schemas?.OrgUnitConflictErrorResponse,
    );
    const properties = z
      .record(z.string(), z.unknown())
      .parse(schema.properties);
    const code = schemaObjectSchema.parse(properties.code);

    expect(code.enum).toEqual(EXPECTED_ORG_UNIT_CONFLICT_CODES);
  });

  it.each([
    ['delete', '/api/v1/chats/{id}'],
    ['delete', '/api/v1/projects/{id}'],
    ['delete', '/api/v1/pins/{itemType}/{itemId}'],
    ['delete', '/api/v1/org-units/{id}'],
    ['post', '/api/v1/org-units/{id}/memberships'],
  ] as const)('%s %s documents 204 without a response body', (method, path) => {
    expect(response(method, path, '204')).not.toHaveProperty('content');
  });

  it('documents the breaking owner-scoped Knowledge Space REST surface', () => {
    expect(
      operation('post', '/api/v1/knowledge-spaces').responses,
    ).toHaveProperty('201');
    expect(
      operation('get', '/api/v1/knowledge-spaces').responses,
    ).toHaveProperty('200');
    expect(
      operation('get', '/api/v1/knowledge-spaces/{id}').responses,
    ).toHaveProperty('200');
    expect(
      operation('patch', '/api/v1/knowledge-spaces/{id}').responses,
    ).toHaveProperty('200');
    const listParameters = z
      .array(
        z.object({
          name: z.string(),
          schema: z.object({ type: z.string() }).passthrough(),
        }),
      )
      .parse(operation('get', '/api/v1/knowledge-spaces').parameters);
    expect(
      listParameters.find(({ name }) => name === 'limit')?.schema.type,
    ).toBe('integer');
    expect(document.paths).not.toHaveProperty('/api/v1/me/knowledge-space');
  });

  it.each([
    [
      'post',
      '/api/v1/org-units/{id}/children',
      '409',
      'OrgUnitConflictErrorResponse',
    ],
    ['patch', '/api/v1/org-units/{id}', '409', 'OrgUnitConflictErrorResponse'],
    ['delete', '/api/v1/org-units/{id}', '409', 'OrgUnitConflictErrorResponse'],
    [
      'post',
      '/api/v1/org-units/{id}/memberships',
      '409',
      'OrgUnitConflictErrorResponse',
    ],
    [
      'patch',
      '/api/v1/org-units/{id}/memberships/{userId}',
      '409',
      'OrgUnitConflictErrorResponse',
    ],
    [
      'delete',
      '/api/v1/org-units/{id}/memberships/{userId}',
      '409',
      'OrgUnitConflictErrorResponse',
    ],
    [
      'patch',
      '/api/v1/org-units/{id}',
      '422',
      'OrgUnitValidationErrorResponse',
    ],
  ] as const)(
    '%s %s %s references the reusable %s',
    (method, path, status, schemaName) => {
      const schema = referenceObjectSchema.parse(
        response(method, path, status).content?.['application/json']?.schema,
      );
      expect(schema).toEqual({
        $ref: `#/components/schemas/${schemaName}`,
      });
    },
  );
});
