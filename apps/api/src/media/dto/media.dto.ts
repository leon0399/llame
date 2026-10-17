import {
  ApiProperty,
  ApiPropertyOptional,
  getSchemaPath,
} from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Matches, Max, Min } from 'class-validator';

import { ErrorResponse } from '../../common/dto/error-response.dto';
import { type MediaObject } from '../../db/schema';
import { imageColumns } from '../media-descriptors';
import { MODEL_MEDIA_TYPES, ORIGINAL_MEDIA_TYPES } from '../media-ingest';
import { CANONICAL_MEDIA_ID, mediaLocator } from '../media-locator';
import { PDF_MAX_PAGES, PDF_MEDIA_TYPE } from '../pdf-preparation';

/** Newest-first page size bounds of `GET /api/v1/media`. */
export const MEDIA_PAGE_DEFAULT_LIMIT = 48;
export const MEDIA_PAGE_MAX_LIMIT = 100;

export class ListMediaQueryDto {
  @ApiPropertyOptional({
    format: 'uuid',
    description:
      "Cursor: return only media older than this id, i.e. the previous page's `nextCursor`.",
  })
  @IsOptional()
  @Matches(CANONICAL_MEDIA_ID)
  before?: string;

  @ApiPropertyOptional({
    type: 'integer',
    minimum: 1,
    maximum: MEDIA_PAGE_MAX_LIMIT,
    default: MEDIA_PAGE_DEFAULT_LIMIT,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MEDIA_PAGE_MAX_LIMIT)
  limit: number = MEDIA_PAGE_DEFAULT_LIMIT;
}

/** The model variant's own format, size, and dimensions. */
export class MediaModelVariantResponse {
  @ApiProperty({ enum: MODEL_MEDIA_TYPES })
  mediaType!: string;

  @ApiProperty()
  width!: number;

  @ApiProperty()
  height!: number;

  @ApiProperty()
  byteSize!: number;
}

/**
 * The closed image descriptor. Top-level fields describe the original. Egress
 * allowlist: no owner id and no digest.
 */
export class MediaDescriptorResponse {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 'media://01920000-0000-7000-8000-000000000000' })
  locator!: string;

  @ApiProperty({ enum: ORIGINAL_MEDIA_TYPES })
  mediaType!: string;

  @ApiProperty({ description: 'Single-line source label' })
  name!: string;

  @ApiProperty()
  width!: number;

  @ApiProperty()
  height!: number;

  @ApiProperty()
  byteSize!: number;

  @ApiProperty({ type: MediaModelVariantResponse })
  model!: MediaModelVariantResponse;
}

/**
 * The closed PDF descriptor: the original only, which has no dimensions and
 * no model variant. Egress allowlist: no owner id and no digest.
 */
export class MediaPdfDescriptorResponse {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 'media://01920000-0000-7000-8000-000000000000' })
  locator!: string;

  @ApiProperty({ enum: [PDF_MEDIA_TYPE] })
  mediaType!: typeof PDF_MEDIA_TYPE;

  @ApiProperty({ description: 'Single-line source label' })
  name!: string;

  @ApiProperty()
  byteSize!: number;

  @ApiProperty({ minimum: 1, maximum: PDF_MAX_PAGES })
  pages!: number;
}

export type MediaResponse =
  | MediaDescriptorResponse
  | MediaPdfDescriptorResponse;

/** The descriptor union; the controller registers both models. */
export const MEDIA_RESPONSE_SCHEMA = {
  oneOf: [
    { $ref: getSchemaPath(MediaDescriptorResponse) },
    { $ref: getSchemaPath(MediaPdfDescriptorResponse) },
  ],
};

/** One newest-first page of the caller's media. */
export class MediaPageResponse {
  @ApiProperty({ type: 'array', items: MEDIA_RESPONSE_SCHEMA })
  items!: Array<MediaResponse>;

  @ApiProperty({
    type: String,
    format: 'uuid',
    nullable: true,
    description: 'The `before` of the next page; null on the last page.',
  })
  nextCursor!: string | null;
}

export function toMediaDescriptor(media: MediaObject): MediaResponse {
  const { id, name, byteSize } = media;
  const locator = mediaLocator(id);
  // Only a PDF row has a page count (media_objects_shape).
  if (media.pageCount !== null) {
    return {
      id,
      locator,
      mediaType: PDF_MEDIA_TYPE,
      name,
      byteSize,
      pages: media.pageCount,
    };
  }
  const image = imageColumns(media);
  if (image === undefined) {
    throw new Error(`Media ${id} has neither the image nor the PDF shape`);
  }
  return {
    id,
    locator,
    mediaType: media.mediaType,
    name,
    width: image.width,
    height: image.height,
    byteSize,
    model: {
      mediaType: image.modelMediaType,
      width: image.modelWidth,
      height: image.modelHeight,
      byteSize: image.modelByteSize,
    },
  };
}

export class MediaTooLargeErrorResponse extends ErrorResponse {
  @ApiProperty({ enum: ['media_too_large'] })
  code!: 'media_too_large';
}

export class MediaUnsupportedErrorResponse extends ErrorResponse {
  @ApiProperty({ enum: ['unsupported_media_type'] })
  code!: 'unsupported_media_type';
}
