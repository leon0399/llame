import {
  type ArgumentMetadata,
  Injectable,
  type PipeTransform,
  ValidationPipe,
} from '@nestjs/common';
import { isRecord } from '@workspace/runtime-safety';

import {
  ContinueFollowUpRunDto,
  RegenerateFollowUpRunDto,
} from './dto/follow-up-run.dto';

/**
 * The follow-up body is a discriminated union on `action`, and a union type
 * erases the metatype the global validation pipe reads from the handler
 * parameter. This pipe reads `action` and runs the same validation against the
 * variant that names it, so a body carrying a field its action does not accept
 * is rejected as an unknown property instead of being silently ignored, and the
 * runtime stays exactly as strict as the published schema.
 */
@Injectable()
export class FollowUpRunBodyPipe implements PipeTransform {
  private readonly validation = {
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
  };

  private readonly continueBody = new ValidationPipe({
    ...this.validation,
    expectedType: ContinueFollowUpRunDto,
  });

  private readonly regenerateBody = new ValidationPipe({
    ...this.validation,
    expectedType: RegenerateFollowUpRunDto,
  });

  async transform(
    // eslint-disable-next-line anti-slop/no-unknown-parameters -- this pipe IS the I/O boundary: it reads `action` and hands the body to the variant's own parser below.
    value: unknown,
    metadata: ArgumentMetadata,
  ): Promise<ContinueFollowUpRunDto | RegenerateFollowUpRunDto> {
    const variant =
      isRecord(value) && value['action'] === 'regenerate'
        ? this.regenerateBody
        : this.continueBody;
    // SAFETY: `expectedType` makes ValidationPipe parse and validate the body
    // as that variant class, which is the shape it returns.
    // eslint-disable-next-line typescript/no-unsafe-type-assertion
    return (await variant.transform(value, metadata)) as
      | ContinueFollowUpRunDto
      | RegenerateFollowUpRunDto;
  }
}
