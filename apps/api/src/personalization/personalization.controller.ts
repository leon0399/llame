import { Body, Controller, Get, Patch } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCookieAuth,
  ApiOkResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { CurrentUser } from '../auth/auth-context';
import {
  PersonalizationResponse,
  toPersonalizationResponse,
  UpdatePersonalizationDto,
} from './dto/personalization.dto';
import { type PersonalizationUpdate } from './personalization-repository';
import { PersonalizationService } from './personalization.service';

// HTTP endpoints are safe to expose only because SessionAuthGuard derives the
// tenant identity from a verified session (see ChatsModule's own note). The
// owner is ALWAYS `@CurrentUser()` — this controller has no route parameter,
// query, or body field naming a user, so there is nothing for a caller to
// supply that could target someone else's profile.
@ApiTags('personalization')
@ApiBearerAuth('bearer')
@ApiCookieAuth('cookie')
@Controller('api/v1/me/personalization')
export class PersonalizationController {
  constructor(private readonly personalization: PersonalizationService) {}

  @Get()
  @ApiOkResponse({ type: PersonalizationResponse })
  @ApiUnauthorizedResponse()
  async getPersonalization(
    @CurrentUser() userId: string,
  ): Promise<PersonalizationResponse> {
    return toPersonalizationResponse(
      await this.personalization.getForOwner(userId),
    );
  }

  @Patch()
  @ApiOkResponse({ type: PersonalizationResponse })
  @ApiUnauthorizedResponse()
  async updatePersonalization(
    @CurrentUser() userId: string,
    @Body() input: UpdatePersonalizationDto,
  ): Promise<PersonalizationResponse> {
    // Conditional spread per field, not a spread of `input`: an omitted field
    // must stay untouched while an explicit null clears it, and an unset DTO
    // field is an own `undefined` property (class fields are defined), so
    // spreading `input` would write undefined over every absent key and wipe
    // the profile on a single-field PATCH.
    const update: PersonalizationUpdate = {};
    if (input.preferredName !== undefined) {
      update.preferredName = input.preferredName;
    }
    if (input.about !== undefined) update.about = input.about;
    if (input.responsePreferences !== undefined) {
      update.responsePreferences = input.responsePreferences;
    }
    if (input.enabled !== undefined) update.enabled = input.enabled;
    if (input.shareAccountIdentity !== undefined) {
      update.shareAccountIdentity = input.shareAccountIdentity;
    }

    return toPersonalizationResponse(
      await this.personalization.updateForOwner(userId, update),
    );
  }
}
