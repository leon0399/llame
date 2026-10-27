/**
 * The route-scoped pipe that validates the follow-up body against the variant
 * its `action` names (turn-actions D2). A union type erases the metatype the
 * global validation pipe reads, so this pipe is the only thing standing between
 * a request and the handler: it must accept each documented body, return the
 * parsed variant, and reject a body the action does not describe.
 */

import { type ArgumentMetadata, BadRequestException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';

import {
  ContinueFollowUpRunDto,
  RegenerateFollowUpRunDto,
} from './dto/follow-up-run.dto';
import { FollowUpRunBodyPipe } from './follow-up-run-body.pipe';

/** What the global pipe hands a route-scoped pipe for a union-typed body. */
const bodyMetadata: ArgumentMetadata = {
  type: 'body',
  metatype: Object,
  data: undefined,
};

const pipe = new FollowUpRunBodyPipe();

// eslint-disable-next-line anti-slop/no-unknown-parameters -- the pipe's own input is an unvalidated request body, which is what these cases hand it.
function transform(value: unknown) {
  return pipe.transform(value, bodyMetadata);
}

describe('FollowUpRunBodyPipe', () => {
  it('accepts a continue body and returns the continue variant', async () => {
    const parsed = await transform({ action: 'continue' });

    expect(parsed).toBeInstanceOf(ContinueFollowUpRunDto);
    expect(parsed).toEqual({ action: 'continue' });
  });

  it('accepts a regenerate body and returns the regenerate variant', async () => {
    const parsed = await transform({
      action: 'regenerate',
      modelId: 'model-a',
      effort: 'high',
      permissionMode: 'bypass',
    });

    expect(parsed).toBeInstanceOf(RegenerateFollowUpRunDto);
    expect(parsed).toEqual({
      action: 'regenerate',
      modelId: 'model-a',
      effort: 'high',
      permissionMode: 'bypass',
    });
  });

  it('rejects a continue body that names a model or an effort', async () => {
    await expect(
      transform({ action: 'continue', modelId: 'model-a' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      transform({ action: 'continue', effort: 'high' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects a regenerate body without its model', async () => {
    await expect(transform({ action: 'regenerate' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('rejects a field neither variant declares', async () => {
    await expect(
      transform({ action: 'regenerate', modelId: 'model-a', extra: true }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects a body whose action names no variant', async () => {
    await expect(transform({ action: 'retry' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('rejects a body with no action at all', async () => {
    await expect(transform({})).rejects.toBeInstanceOf(BadRequestException);
  });
});
