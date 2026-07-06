import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiParam,
  ApiResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';

import { CurrentUser } from '../auth/auth-context';
import { SecretString } from './credential-crypto';
import { ProvidersService } from './providers.service';
import {
  CreateProviderAccountDto,
  ProviderAccountResponse,
  toProviderAccountResponse,
} from './dto/provider-accounts.dto';

/**
 * BYOK provider accounts (#18, SPEC §14): user-scope CRUD. The API key is
 * accepted on create only (write-only), sealed into the credential vault
 * immediately, and never appears in any response. Org-scope accounts arrive
 * with the admin surface.
 */
@ApiTags('providers')
@ApiBearerAuth('bearer')
@ApiCookieAuth('cookie')
@Controller('api/v1/provider-accounts')
export class ProvidersController {
  constructor(private readonly providers: ProvidersService) {}

  @Get()
  @ApiOkResponse({ type: ProviderAccountResponse, isArray: true })
  @ApiUnauthorizedResponse()
  async list(
    @CurrentUser() userId: string,
  ): Promise<ProviderAccountResponse[]> {
    const accounts = await this.providers.listUserAccounts(userId);
    return accounts.map(toProviderAccountResponse);
  }

  @Post()
  @ApiCreatedResponse({ type: ProviderAccountResponse })
  @ApiBadRequestResponse({
    description: 'Invalid body, or BYOK disabled (no CREDENTIAL_MASTER_KEYS)',
  })
  @ApiUnauthorizedResponse()
  async create(
    @CurrentUser() userId: string,
    @Body() dto: CreateProviderAccountDto,
  ): Promise<ProviderAccountResponse> {
    const account = await this.providers.createUserAccount({
      userId,
      providerType: dto.providerType,
      displayName: dto.displayName,
      // Wrapped before it crosses any further boundary — logging the DTO
      // downstream of here cannot leak it (SecretString redacts itself).
      // Trimmed defensively: a copy-pasted key with a trailing newline/space
      // would otherwise seal and silently fail every provider call.
      apiKey: new SecretString(dto.apiKey.trim()),
      ...(dto.baseUrl !== undefined ? { baseUrl: dto.baseUrl } : {}),
      ...(dto.defaultModel !== undefined
        ? { defaultModel: dto.defaultModel }
        : {}),
    });
    return toProviderAccountResponse(account);
  }

  @Delete(':id')
  @HttpCode(204)
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiResponse({ status: 204, description: 'Account and credentials deleted' })
  @ApiNotFoundResponse({ description: 'Unknown or cross-tenant account' })
  @ApiUnauthorizedResponse()
  async remove(
    @CurrentUser() userId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    await this.providers.removeUserAccount(userId, id);
  }
}
