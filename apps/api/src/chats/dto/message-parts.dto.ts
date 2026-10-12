import {
  ApiProperty,
  ApiPropertyOptional,
  getSchemaPath,
} from '@nestjs/swagger';
import { plainToInstance, Transform } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsIn,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  Validate,
  ValidateIf,
  ValidateNested,
  ValidatorConstraint,
  type ValidatorConstraintInterface,
} from 'class-validator';
import { isRecord } from '@workspace/runtime-safety';
import { MEDIA_LOCATOR_PATTERN } from '../../media/media-locator';

export class CreateTextMessagePartDto {
  @ApiProperty({ enum: ['text'] })
  @IsIn(['text'])
  type!: 'text';

  @ApiProperty({ minLength: 1, maxLength: 20_000 })
  @IsString()
  @Matches(/\S/, { message: 'text must not be blank' })
  @MaxLength(20_000)
  text!: string;
}

/**
 * An owner attachment (vision-media D5): the AI SDK `file` part shape. Only
 * `url` is trusted; the server stores the media's own `mediaType` and name.
 */
export class CreateFileMessagePartDto {
  @ApiProperty({ enum: ['file'] })
  @IsIn(['file'])
  type!: 'file';

  @ApiProperty({
    description: "Ignored: the stored part carries the media's own type.",
  })
  @IsString()
  mediaType!: string;

  @ApiProperty({
    pattern: MEDIA_LOCATOR_PATTERN.source,
    description: 'A `media://<id>` locator of media the sender owns.',
  })
  @IsString()
  @Matches(MEDIA_LOCATOR_PATTERN, {
    message: 'url must be a media://<id> locator',
  })
  url!: string;

  @ApiPropertyOptional({
    description: "Ignored: the stored part carries the media's own name.",
  })
  @ValidateIf((o: CreateFileMessagePartDto) => o.filename !== undefined)
  @IsString()
  filename?: string;
}

/**
 * Where a part whose `type` is neither `text` nor `file` lands, so it fails
 * validation (and any extra keys fail the whitelist) instead of passing as an
 * unvalidated object.
 */
class UnknownMessagePartDto {
  @IsIn(['text', 'file'])
  type!: string;
}

/**
 * Each part's DTO, chosen by its `type`. class-transformer's discriminator is
 * not used because it reads `type` off a `null` element and throws, turning
 * a malformed body into a 500; a non-object here is left for ValidateNested
 * to reject.
 */
function toMessagePartDto(part: unknown) {
  if (!isRecord(part)) return part;
  if (part.type === 'text') {
    return plainToInstance(CreateTextMessagePartDto, part);
  }
  if (part.type === 'file') {
    return plainToInstance(CreateFileMessagePartDto, part);
  }
  return plainToInstance(UnknownMessagePartDto, part);
}

const MAX_TEXT_PARTS = 50;
const MAX_FILE_PARTS = 10;

@ValidatorConstraint({ name: 'messagePartCounts', async: false })
class MessagePartCountsConstraint implements ValidatorConstraintInterface {
  validate(parts: unknown): boolean {
    // A non-array is IsArray's to report.
    if (!Array.isArray(parts)) return true;
    const count = (type: string) =>
      parts.filter((part) => isRecord(part) && part.type === type).length;
    return count('text') <= MAX_TEXT_PARTS && count('file') <= MAX_FILE_PARTS;
  }

  defaultMessage(): string {
    return `parts must contain at most ${MAX_TEXT_PARTS} text parts and ${MAX_FILE_PARTS} file parts`;
  }
}

export class CreateMessageBodyDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  id!: string;

  @ApiProperty({
    type: 'array',
    items: {
      oneOf: [
        { $ref: getSchemaPath(CreateTextMessagePartDto) },
        { $ref: getSchemaPath(CreateFileMessagePartDto) },
      ],
    },
    minItems: 1,
    maxItems: MAX_TEXT_PARTS + MAX_FILE_PARTS,
    description: `At most ${MAX_TEXT_PARTS} text parts and ${MAX_FILE_PARTS} file parts, in order; at least one part.`,
  })
  @IsArray()
  @ArrayMinSize(1)
  @Validate(MessagePartCountsConstraint)
  @ValidateNested({ each: true })
  @Transform(({ value }: { value: unknown }) =>
    Array.isArray(value) ? value.map(toMessagePartDto) : value,
  )
  parts!: Array<CreateTextMessagePartDto | CreateFileMessagePartDto>;
}
