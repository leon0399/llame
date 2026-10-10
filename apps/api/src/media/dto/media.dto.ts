import { ApiProperty } from '@nestjs/swagger';

import { ErrorResponse } from '../../common/dto/error-response.dto';
import { type MediaObject } from '../../db/schema';
import { mediaLocator } from '../media-locator';

const MEDIA_PROVENANCES = ['upload', 'read', 'prompt-import'] as const;
const ORIGINAL_MEDIA_TYPES = [
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
] as const;
const MODEL_MEDIA_TYPES = ['image/png', 'image/jpeg'] as const;

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
 * The closed media descriptor. Top-level fields describe the original. Egress
 * allowlist: no owner id and no digest.
 */
export class MediaDescriptorResponse {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 'media://01920000-0000-7000-8000-000000000000' })
  locator!: string;

  @ApiProperty({ enum: MEDIA_PROVENANCES })
  provenance!: string;

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

export function toMediaDescriptor(media: MediaObject): MediaDescriptorResponse {
  return {
    id: media.id,
    locator: mediaLocator(media.id),
    provenance: media.provenance,
    mediaType: media.mediaType,
    name: media.name,
    width: media.width,
    height: media.height,
    byteSize: media.byteSize,
    model: {
      mediaType: media.modelMediaType,
      width: media.modelWidth,
      height: media.modelHeight,
      byteSize: media.modelByteSize,
    },
  };
}

export class MediaTooLargeErrorResponse extends ErrorResponse {
  @ApiProperty({ enum: ['image_too_large'] })
  code!: 'image_too_large';
}

export class MediaUnsupportedErrorResponse extends ErrorResponse {
  @ApiProperty({ enum: ['unsupported_media_type'] })
  code!: 'unsupported_media_type';
}
