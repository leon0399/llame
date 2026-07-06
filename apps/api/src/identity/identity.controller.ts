import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConflictResponse,
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiParam,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';

import { CurrentUser } from '../auth/auth-context';
import { IdentityService } from './identity.service';
import {
  CreateOrgUnitDto,
  GrantMembershipDto,
  OrgUnitResponse,
  toOrgUnitResponse,
} from './dto/identity.dto';

/**
 * Admin surface for org units + memberships (#44). Every op is owner-scoped by
 * the authenticated identity AND the FORCE-RLS policies (defense-in-depth): a
 * caller can only see/act on units they belong to or created, and can only grant/
 * revoke where they are owner/admin on the path. The member ROSTER (listing OTHER
 * members) is deferred — it needs a recursion-safe RLS change.
 */
@ApiTags('org-units')
@ApiBearerAuth('bearer')
@ApiCookieAuth('cookie')
@Controller('api/v1/org-units')
export class IdentityController {
  constructor(private readonly identity: IdentityService) {}

  @Post()
  @HttpCode(201)
  @ApiBody({ type: CreateOrgUnitDto })
  @ApiCreatedResponse({ type: OrgUnitResponse })
  @ApiUnauthorizedResponse()
  async createRootOrg(
    @CurrentUser() userId: string,
    @Body() input: CreateOrgUnitDto,
  ): Promise<OrgUnitResponse> {
    const unit = await this.identity.createRootOrg({
      userId,
      name: input.name,
      ...(input.type ? { type: input.type } : {}),
    });
    return toOrgUnitResponse(unit);
  }

  @Post(':id/children')
  @HttpCode(201)
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiBody({ type: CreateOrgUnitDto })
  @ApiCreatedResponse({ type: OrgUnitResponse })
  @ApiNotFoundResponse({ description: 'Parent unit not found / not visible' })
  @ApiUnauthorizedResponse()
  async createChildOrg(
    @CurrentUser() userId: string,
    @Param('id', ParseUUIDPipe) parentId: string,
    @Body() input: CreateOrgUnitDto,
  ): Promise<OrgUnitResponse> {
    const unit = await this.identity.createChildOrg({
      userId,
      parentId,
      name: input.name,
      ...(input.type ? { type: input.type } : {}),
    });
    return toOrgUnitResponse(unit);
  }

  @Get()
  @ApiOkResponse({ type: OrgUnitResponse, isArray: true })
  @ApiUnauthorizedResponse()
  async listOrgUnits(
    @CurrentUser() userId: string,
  ): Promise<OrgUnitResponse[]> {
    const units = await this.identity.listOrgUnits(userId);
    return units.map(toOrgUnitResponse);
  }

  @Post(':id/memberships')
  @HttpCode(204)
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiBody({ type: GrantMembershipDto })
  @ApiNoContentResponse({ description: 'Membership granted' })
  @ApiConflictResponse({ description: 'User is already a member of this unit' })
  @ApiForbiddenResponse({
    description: 'Caller is not owner/admin on this org unit or an ancestor',
  })
  @ApiNotFoundResponse({ description: 'User or org unit not found' })
  @ApiUnauthorizedResponse()
  async grantMembership(
    @CurrentUser() callerId: string,
    @Param('id', ParseUUIDPipe) orgUnitId: string,
    @Body() input: GrantMembershipDto,
  ): Promise<void> {
    await this.identity.grantMembership({
      callerId,
      userId: input.userId,
      orgUnitId,
      role: input.role,
    });
  }

  // NOTE: revoke (DELETE :id/memberships/:userId) is deferred with the member
  // roster — an admin removing ANOTHER member requires seeing that row, but
  // own-rows `memberships_select` hides it (Postgres applies the SELECT policy to
  // DELETE targets), so both need the same recursion-safe SECURITY DEFINER
  // member-visibility change. Grant is unaffected (it's an INSERT).
}
