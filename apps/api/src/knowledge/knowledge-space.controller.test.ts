import { HttpException, HttpStatus } from '@nestjs/common';

import { AppModule } from '../app.module';
import { KnowledgeSpaceController } from './knowledge-space.controller';
import { KnowledgeSpaceUnavailableError } from './knowledge-space.local-resolver';
import { KnowledgeModule } from './knowledge.module';
import { KnowledgeToolCandidateResolver } from './knowledge-tool-candidate-resolver';
import { KnowledgeToolRuntimeResolver } from './knowledge-tool-runtime-resolver';

const SPACE = {
  id: '6f5d8a0f-7dd3-4f6b-b6ed-9e0f0b1c2d3e',
  name: 'Personal',
  createdAt: new Date('2026-08-23T12:00:00.000Z'),
  updatedAt: new Date('2026-08-23T12:00:00.000Z'),
};

const noOp = vi.fn();

describe('KnowledgeSpaceController', () => {
  it('is wired into the application module', () => {
    const imports: unknown = Reflect.getMetadata('imports', AppModule);
    expect(imports).toContain(KnowledgeModule);
  });

  it('exports the accepted-turn candidate capability', () => {
    const exports: unknown = Reflect.getMetadata('exports', KnowledgeModule);
    expect(exports).toContain(KnowledgeToolCandidateResolver);
  });

  it('exports the worker-side runtime capability', () => {
    const exports: unknown = Reflect.getMetadata('exports', KnowledgeModule);
    expect(exports).toContain(KnowledgeToolRuntimeResolver);
  });

  it('creates a named resource and sets its Location header', async () => {
    const provisionForOwner = vi.fn().mockResolvedValue(SPACE);
    const controller = new KnowledgeSpaceController({
      provisionForOwner,
      listForOwner: noOp,
      getForOwner: noOp,
      renameForOwner: noOp,
    });
    const response = { setHeader: vi.fn() };

    await expect(
      controller.createKnowledgeSpace(
        'session-owner',
        { name: 'Personal' },
        response,
      ),
    ).resolves.toEqual(SPACE);
    expect(provisionForOwner).toHaveBeenCalledWith('session-owner', {
      name: 'Personal',
    });
    expect(response.setHeader).toHaveBeenCalledWith(
      'Location',
      `/api/v1/knowledge-spaces/${SPACE.id}`,
    );
  });

  it('lists a bounded owner inventory with an opaque next cursor', async () => {
    const listForOwner = vi.fn().mockResolvedValue({
      items: [SPACE],
      nextCursor: 'opaque-cursor',
    });
    const controller = new KnowledgeSpaceController({
      provisionForOwner: noOp,
      listForOwner,
      getForOwner: noOp,
      renameForOwner: noOp,
    });

    await expect(
      controller.listKnowledgeSpaces('session-owner', {
        limit: 50,
        after: 'opaque-cursor',
      }),
    ).resolves.toEqual({ items: [SPACE], nextCursor: 'opaque-cursor' });
    expect(listForOwner).toHaveBeenCalledWith('session-owner', {
      limit: 50,
      after: 'opaque-cursor',
    });
  });

  it('returns the same 404 shape for absent and other-owner IDs', async () => {
    const getForOwner = vi.fn().mockResolvedValue(undefined);
    const controller = new KnowledgeSpaceController({
      provisionForOwner: noOp,
      listForOwner: noOp,
      getForOwner,
      renameForOwner: noOp,
    });

    for (const owner of ['session-owner', 'other-owner']) {
      await expect(
        controller.getKnowledgeSpace(owner, SPACE.id),
      ).rejects.toMatchObject({
        status: HttpStatus.NOT_FOUND,
        response: { message: 'Knowledge Space not found' },
      });
    }
  });

  it('maps local provisioning failures to the safe 503 response', async () => {
    const controller = new KnowledgeSpaceController({
      provisionForOwner: vi
        .fn()
        .mockRejectedValue(new KnowledgeSpaceUnavailableError()),
      listForOwner: noOp,
      getForOwner: noOp,
      renameForOwner: noOp,
    });

    try {
      await controller.createKnowledgeSpace(
        'session-owner',
        { name: 'Personal' },
        { setHeader: vi.fn() },
      );
      throw new Error('expected controller to throw');
    } catch (error) {
      if (!(error instanceof HttpException)) throw error;
      expect(error.getStatus()).toBe(HttpStatus.SERVICE_UNAVAILABLE);
    }
  });
});
