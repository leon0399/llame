import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
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
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiUnauthorizedResponse,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';

import { CurrentUser } from '../auth/auth-context';
import {
  OrgUnitConflictErrorResponse,
  OrgUnitValidationErrorResponse,
} from '../common/dto/error-response.dto';
import { IdentityService } from './identity.service';
import {
  ChangeMembershipRoleDto,
  CreateOrgUnitDto,
  EffectiveRoleResponse,
  GrantMembershipDto,
  MembershipResponse,
  OrgUnitResponse,
  UpdateOrgUnitDto,
  toMembershipResponse,
  toOrgUnitResponse,
} from './dto/identity.dto';

/**
 * Admin surface for org units + memberships (#44, D5). Every op is scoped by
 * the authenticated identity AND the FORCE-RLS policies (defense-in-depth): a
 * caller can only see/act on units they belong to or created, and can only
 * grant/revoke/administer where the datastore's role-tier checks admit it.
 */
@ApiTags('org-units')
@ApiBearerAuth('bearer')
@ApiCookieAuth('cookie')
@Controller('api/v1/org-units')
export class IdentityController {
  constructor(private readonly identity: IdentityService) {}

  @Post()
  @ApiOperation({ operationId: 'createRootOrgUnit' })
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
      ...(input.type && { type: input.type }),
    });
    return toOrgUnitResponse(unit);
  }

  @Post(':id/children')
  @ApiOperation({ operationId: 'createChildOrgUnit' })
  @HttpCode(201)
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiBody({ type: CreateOrgUnitDto })
  @ApiCreatedResponse({ type: OrgUnitResponse })
  @ApiNotFoundResponse({ description: 'Parent unit not found / not visible' })
  @ApiConflictResponse({
    type: OrgUnitConflictErrorResponse,
    description: 'Org tree changed concurrently — retry',
  })
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
      ...(input.type && { type: input.type }),
    });
    return toOrgUnitResponse(unit);
  }

  @Get()
  @ApiOperation({ operationId: 'listOrgUnits' })
  @ApiOkResponse({ type: OrgUnitResponse, isArray: true })
  @ApiUnauthorizedResponse()
  async listOrgUnits(
    @CurrentUser() userId: string,
  ): Promise<Array<OrgUnitResponse>> {
    const units = await this.identity.listOrgUnits(userId);
    return units.map(toOrgUnitResponse);
  }

  @Get(':id')
  @ApiOperation({ operationId: 'getOrgUnit' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: OrgUnitResponse })
  @ApiNotFoundResponse({ description: 'Org unit not found / not visible' })
  @ApiUnauthorizedResponse()
  async getOrgUnit(
    @CurrentUser() userId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<OrgUnitResponse> {
    const unit = await this.identity.getOrgUnit({ userId, orgUnitId: id });
    return toOrgUnitResponse(unit);
  }

  // PATCH (partial update) — rename, replace settings, and/or move, whichever
  // fields are present (RESTful, not RPC verb handles per AGENTS.md). `parentId:
  // null` promotes to root; a unit id moves under it; absence leaves it in place.
  @Patch(':id')
  @ApiOperation({ operationId: 'updateOrgUnit' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiBody({ type: UpdateOrgUnitDto })
  @ApiOkResponse({ type: OrgUnitResponse })
  @ApiNotFoundResponse({
    description: 'Org unit (or the target parentId) not found / not visible',
  })
  @ApiForbiddenResponse({
    description: 'Caller lacks the admin-tier this update requires',
  })
  @ApiConflictResponse({
    type: OrgUnitConflictErrorResponse,
    description: 'Org tree changed concurrently — retry',
  })
  @ApiUnprocessableEntityResponse({
    type: OrgUnitValidationErrorResponse,
    description: 'Cannot move an org unit into its own subtree',
  })
  @ApiUnauthorizedResponse()
  async updateOrgUnit(
    @CurrentUser() userId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() input: UpdateOrgUnitDto,
  ): Promise<OrgUnitResponse> {
    const updateInput: Parameters<typeof this.identity.updateOrgUnit>[0] = {
      userId,
      orgUnitId: id,
    };
    if (input.name !== undefined) updateInput.name = input.name;
    if (input.settings !== undefined) updateInput.settings = input.settings;
    if (input.parentId !== undefined) updateInput.parentId = input.parentId;
    const unit = await this.identity.updateOrgUnit(updateInput);
    return toOrgUnitResponse(unit);
  }

  // Leaf-only (FK RESTRICT — no silent subtree cascade); owner-tier on the path.
  @Delete(':id')
  @ApiOperation({ operationId: 'deleteOrgUnit' })
  @HttpCode(204)
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiNoContentResponse()
  @ApiNotFoundResponse({ description: 'Org unit not found / not visible' })
  @ApiForbiddenResponse({ description: 'Owner-tier required to delete' })
  @ApiConflictResponse({
    type: OrgUnitConflictErrorResponse,
    description: 'Org unit still has child units',
  })
  @ApiUnauthorizedResponse()
  async deleteOrgUnit(
    @CurrentUser() userId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    await this.identity.deleteOrgUnit({ userId, orgUnitId: id });
  }

  @Get(':id/memberships')
  @ApiOperation({ operationId: 'listOrgUnitMemberships' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: MembershipResponse, isArray: true })
  @ApiNotFoundResponse({ description: 'Org unit not found / not visible' })
  @ApiUnauthorizedResponse()
  async listMemberships(
    @CurrentUser() userId: string,
    @Param('id', ParseUUIDPipe) orgUnitId: string,
  ): Promise<Array<MembershipResponse>> {
    const rows = await this.identity.listMemberships({ userId, orgUnitId });
    return rows.map(toMembershipResponse);
  }

  @Post(':id/memberships')
  @ApiOperation({ operationId: 'grantOrgUnitMembership' })
  @HttpCode(204)
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiBody({ type: GrantMembershipDto })
  @ApiNoContentResponse({ description: 'Membership granted' })
  @ApiConflictResponse({
    type: OrgUnitConflictErrorResponse,
    description: 'User is already a member of this unit',
  })
  @ApiForbiddenResponse({
    description:
      'Caller lacks admin-tier on this org unit or an ancestor (owner-tier for role "owner")',
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

  @Patch(':id/memberships/:userId')
  @ApiOperation({ operationId: 'changeOrgUnitMembershipRole' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiParam({ name: 'userId' })
  @ApiBody({ type: ChangeMembershipRoleDto })
  @ApiOkResponse({ type: MembershipResponse })
  @ApiNotFoundResponse({ description: 'Membership not found / not visible' })
  @ApiForbiddenResponse({
    description: 'Caller lacks the admin/owner-tier this role change requires',
  })
  @ApiConflictResponse({
    type: OrgUnitConflictErrorResponse,
    description: 'Would demote the last owner of a root org unit',
  })
  @ApiUnauthorizedResponse()
  async changeMembershipRole(
    @CurrentUser() callerId: string,
    @Param('id', ParseUUIDPipe) orgUnitId: string,
    @Param('userId') userId: string,
    @Body() input: ChangeMembershipRoleDto,
  ): Promise<MembershipResponse> {
    const membership = await this.identity.changeMembershipRole({
      callerId,
      userId,
      orgUnitId,
      role: input.role,
    });
    return toMembershipResponse(membership);
  }

  // Self-leave (any role — D2's last-owner trigger is the actual guard) or an
  // admin/owner-tier caller revoking another member.
  @Delete(':id/memberships/:userId')
  @ApiOperation({ operationId: 'revokeOrgUnitMembership' })
  @HttpCode(204)
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiParam({ name: 'userId' })
  @ApiNoContentResponse()
  @ApiNotFoundResponse({ description: 'Membership not found / not visible' })
  @ApiForbiddenResponse({
    description: 'Caller is neither the member nor admin/owner-tier here',
  })
  @ApiConflictResponse({
    type: OrgUnitConflictErrorResponse,
    description: 'Would remove the last owner of a root org unit',
  })
  @ApiUnauthorizedResponse()
  async revokeMembership(
    @CurrentUser() callerId: string,
    @Param('id', ParseUUIDPipe) orgUnitId: string,
    @Param('userId') userId: string,
  ): Promise<void> {
    await this.identity.revokeMembership({ callerId, userId, orgUnitId });
  }

  @Get(':id/memberships/me')
  @ApiOperation({ operationId: 'getMyOrgUnitEffectiveRole' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: EffectiveRoleResponse })
  @ApiNotFoundResponse({
    description: 'Org unit not visible, or caller holds no role on its path',
  })
  @ApiUnauthorizedResponse()
  async getMyEffectiveRole(
    @CurrentUser() userId: string,
    @Param('id', ParseUUIDPipe) orgUnitId: string,
  ): Promise<EffectiveRoleResponse> {
    const role = await this.identity.resolveRole({ userId, orgUnitId });
    if (!role) {
      throw new NotFoundException(
        `Org unit ${orgUnitId} not found, or you hold no role on its path`,
      );
    }
    return role;
  }
}
