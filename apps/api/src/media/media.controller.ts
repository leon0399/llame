import {
  BadRequestException,
  Catch,
  Controller,
  Get,
  HttpException,
  HttpStatus,
  Inject,
  NotFoundException,
  Param,
  PayloadTooLargeException,
  Post,
  Req,
  Res,
  UploadedFile,
  UseFilters,
  UseInterceptors,
  type ArgumentsHost,
  type ExceptionFilter,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiExtraModels,
  ApiNotFoundResponse,
  ApiNotModifiedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiPayloadTooLargeResponse,
  ApiProduces,
  ApiTags,
  ApiUnauthorizedResponse,
  ApiUnsupportedMediaTypeResponse,
} from '@nestjs/swagger';
import type { Request, Response } from 'express';
// Also loads @types/multer's global `Express.Multer.File` (tsconfig pins
// `types`, so it is not ambient otherwise).
import type { Options as MulterOptions } from 'multer';

import { CurrentUser } from '../auth/auth-context';
import { type MediaVariant } from '../db/schema';
import {
  MEDIA_RESPONSE_SCHEMA,
  MediaDescriptorResponse,
  MediaPdfDescriptorResponse,
  MediaTooLargeErrorResponse,
  MediaUnsupportedErrorResponse,
  toMediaDescriptor,
  type MediaResponse,
} from './dto/media.dto';
import {
  MEDIA_MAX_BYTES,
  MEDIA_REFUSAL,
  MediaIngestError,
} from './media-ingest';
import { MediaService } from './media.service';

/** One byte-route request: who asks for which variant. */
type VariantRequest = {
  userId: string;
  id: string;
  variant: MediaVariant;
};

// Memory storage (multer's default). Only the one file part is read: any text
// field or further part aborts with a multer `LIMIT_*` error that Nest maps to
// 400, so no non-file part is buffered (busboy fires `parts` when the count
// reaches the limit, so 2 still admits a lone file). `LIMIT_FILE_SIZE` is the
// only multer error Nest maps to 413.
const UPLOAD_OPTIONS = {
  limits: { fileSize: MEDIA_MAX_BYTES, files: 1, fields: 0, parts: 2 },
  // Browsers send UTF-8 filenames; multer's default is latin1.
  defParamCharset: 'utf8',
} satisfies MulterOptions;

/** The one HTTP body of each ingest refusal, whichever layer detects it. */
function ingestRefusal(error: MediaIngestError): HttpException {
  const tooLarge = error.code === 'media_too_large';
  const statusCode = tooLarge
    ? HttpStatus.PAYLOAD_TOO_LARGE
    : HttpStatus.UNSUPPORTED_MEDIA_TYPE;
  return new HttpException(
    {
      statusCode,
      error: tooLarge ? 'Payload Too Large' : 'Unsupported Media Type',
      message: error.message,
      code: error.code,
    },
    statusCode,
  );
}

/**
 * Multer's `LIMIT_FILE_SIZE` reaches Nest as a generic
 * `PayloadTooLargeException`; it is the only multer limit Nest maps to 413,
 * so every such exception on the upload route is the ingest byte bound,
 * which fires before the format is detected.
 */
@Catch(PayloadTooLargeException)
class UploadTooLargeFilter implements ExceptionFilter {
  catch(_exception: PayloadTooLargeException, host: ArgumentsHost): void {
    const refusal = ingestRefusal(
      new MediaIngestError(MEDIA_REFUSAL.fileTooLarge),
    );
    host
      .switchToHttp()
      .getResponse<Response>()
      .status(refusal.getStatus())
      .json(refusal.getResponse());
  }
}

const MEDIA_ID_PARAM = {
  name: 'id',
  format: 'uuid',
  description: 'Lower-case canonical UUID',
};

// Identity comes only from the verified session (global SessionAuthGuard); no
// route parameter or body field selects an owner. Another owner's id, an
// unknown id, and a non-canonical id all answer the same 404. There is
// deliberately no DELETE route: media is retained (vision-media D3).
@ApiTags('media')
@ApiBearerAuth('bearer')
@ApiCookieAuth('cookie')
@ApiExtraModels(MediaDescriptorResponse, MediaPdfDescriptorResponse)
@Controller('api/v1/media')
export class MediaController {
  constructor(
    @Inject(MediaService)
    private readonly media: MediaService,
  ) {}

  @Post()
  @ApiOperation({ operationId: 'uploadMedia' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file'],
      properties: { file: { type: 'string', format: 'binary' } },
    },
  })
  @ApiCreatedResponse({
    schema: MEDIA_RESPONSE_SCHEMA,
    description: 'A new media object was created',
  })
  @ApiOkResponse({
    schema: MEDIA_RESPONSE_SCHEMA,
    description: 'The same bytes were already stored and are reused',
  })
  @ApiBadRequestResponse({ description: 'No file, or more than one file' })
  @ApiUnauthorizedResponse()
  @ApiPayloadTooLargeResponse({ type: MediaTooLargeErrorResponse })
  @ApiUnsupportedMediaTypeResponse({ type: MediaUnsupportedErrorResponse })
  @UseFilters(UploadTooLargeFilter)
  @UseInterceptors(FileInterceptor('file', UPLOAD_OPTIONS))
  async upload(
    @CurrentUser() userId: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Res({ passthrough: true }) res: Response,
  ): Promise<MediaResponse> {
    if (file === undefined) {
      throw new BadRequestException('Exactly one file field named "file"');
    }
    try {
      const { media, created } = await this.media.ingest(userId, {
        bytes: file.buffer,
        source: file.originalname,
      });
      res.status(created ? HttpStatus.CREATED : HttpStatus.OK);
      return toMediaDescriptor(media);
    } catch (error) {
      if (error instanceof MediaIngestError) throw ingestRefusal(error);
      throw error;
    }
  }

  @Get(':id')
  @ApiOperation({ operationId: 'getMedia' })
  @ApiParam(MEDIA_ID_PARAM)
  @ApiOkResponse({ schema: MEDIA_RESPONSE_SCHEMA })
  @ApiUnauthorizedResponse()
  @ApiNotFoundResponse()
  async getMedia(
    @CurrentUser() userId: string,
    @Param('id') id: string,
  ): Promise<MediaResponse> {
    const media = await this.media.findOwned(userId, id);
    if (media === undefined) throw new NotFoundException();
    return toMediaDescriptor(media);
  }

  @Get(':id/original')
  @ApiOperation({ operationId: 'getMediaOriginal' })
  @ApiParam(MEDIA_ID_PARAM)
  @ApiProduces(
    'image/png',
    'image/jpeg',
    'image/gif',
    'image/webp',
    'application/pdf',
  )
  @ApiOkResponse({ schema: { type: 'string', format: 'binary' } })
  @ApiNotModifiedResponse()
  @ApiUnauthorizedResponse()
  @ApiNotFoundResponse()
  async getOriginal(
    @CurrentUser() userId: string,
    @Param('id') id: string,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    await this.sendVariant({ userId, id, variant: 'original' }, req, res);
  }

  @Get(':id/model')
  @ApiOperation({ operationId: 'getMediaModel' })
  @ApiParam(MEDIA_ID_PARAM)
  @ApiProduces('image/png', 'image/jpeg')
  @ApiOkResponse({ schema: { type: 'string', format: 'binary' } })
  @ApiNotModifiedResponse()
  @ApiUnauthorizedResponse()
  @ApiNotFoundResponse()
  async getModel(
    @CurrentUser() userId: string,
    @Param('id') id: string,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    await this.sendVariant({ userId, id, variant: 'model' }, req, res);
  }

  /**
   * Ownership resolves before `If-None-Match` is evaluated, so a validator
   * cached under another owner's session earns a 404, never a 304. A PDF has
   * no model media type, so its `model` is that same 404 (pdf-media D2).
   */
  private async sendVariant(
    { userId, id, variant }: VariantRequest,
    req: Request,
    res: Response,
  ): Promise<void> {
    const media = await this.media.findOwned(userId, id);
    if (media === undefined) throw new NotFoundException();
    const contentType =
      variant === 'original' ? media.mediaType : media.modelMediaType;
    if (contentType === null) throw new NotFoundException();

    // The bytes under an id never change, so digest + variant is a strong
    // validator.
    res.setHeader('ETag', `"${media.sha256}-${variant}"`);
    res.setHeader('Cache-Control', 'private, no-cache');
    // Express compares If-None-Match (weak, list-aware) with the ETag above.
    if (req.fresh) {
      res.status(HttpStatus.NOT_MODIFIED).end();
      return;
    }

    const bytes = await this.media.readVariant(userId, id, variant);
    if (bytes === undefined) throw new NotFoundException();
    res.setHeader('Content-Type', contentType);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Disposition', 'inline');
    res.setHeader('Content-Security-Policy', 'sandbox');
    // A single `end` with the body lets Node set Content-Length.
    res.status(HttpStatus.OK).end(bytes);
  }
}
