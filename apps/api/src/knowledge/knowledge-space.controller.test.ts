import { HttpException, HttpStatus } from '@nestjs/common';

import { AppModule } from '../app.module';
import { KnowledgeSpaceController } from './knowledge-space.controller';
import { KnowledgeSpaceUnavailableError } from './knowledge-space.local-resolver';
import { KnowledgeModule } from './knowledge.module';
import { KnowledgeToolCandidateResolver } from './knowledge-tool-candidate-resolver';
import { KnowledgeToolRuntimeResolver } from './knowledge-tool-runtime-resolver';

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

  it('uses only the authenticated owner and returns the logical projection', async () => {
    const provisionForOwner = vi.fn().mockResolvedValue({
      id: '6f5d8a0f-7dd3-4f6b-b6ed-9e0f0b1c2d3e',
    });
    const controller = new KnowledgeSpaceController({ provisionForOwner });

    await expect(
      controller.putKnowledgeSpace('session-owner', {}),
    ).resolves.toEqual({ id: '6f5d8a0f-7dd3-4f6b-b6ed-9e0f0b1c2d3e' });
    expect(provisionForOwner).toHaveBeenCalledWith('session-owner');
  });

  it('accepts an empty body but rejects selector-shaped request bodies', async () => {
    const provisionForOwner = vi.fn().mockResolvedValue({
      id: '6f5d8a0f-7dd3-4f6b-b6ed-9e0f0b1c2d3e',
    });
    const controller = new KnowledgeSpaceController({ provisionForOwner });

    await expect(
      controller.putKnowledgeSpace('session-owner', { body: undefined }),
    ).resolves.toEqual({ id: '6f5d8a0f-7dd3-4f6b-b6ed-9e0f0b1c2d3e' });
    await expect(
      controller.putKnowledgeSpace('session-owner', {
        body: { ownerUserId: 'attacker-controlled' },
      }),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      controller.putKnowledgeSpace('session-owner', {
        body: { directory: '/tmp/attacker-controlled' },
      }),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      controller.putKnowledgeSpace('session-owner', {
        body: ['not-an-object'],
      }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('returns the documented safe 503 response when provisioning is unavailable', async () => {
    const controller = new KnowledgeSpaceController({
      provisionForOwner: vi
        .fn()
        .mockRejectedValue(new KnowledgeSpaceUnavailableError()),
    });

    try {
      await controller.putKnowledgeSpace('session-owner', {});
      throw new Error('expected controller to throw');
    } catch (error) {
      if (!(error instanceof HttpException)) {
        throw new Error('Expected an HttpException');
      }
      expect(error.getStatus()).toBe(HttpStatus.SERVICE_UNAVAILABLE);
      expect(error.getResponse()).toEqual({
        statusCode: 503,
        error: 'Service Unavailable',
        code: 'knowledge_space_unavailable',
        message: 'Knowledge Space is unavailable.',
      });
    }
  });
});
