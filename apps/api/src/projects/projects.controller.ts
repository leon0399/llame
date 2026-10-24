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
  Query,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { CurrentUser } from '../auth/auth-context';
import { ProjectsService } from './projects.service';
import {
  CreateProjectDto,
  ListProjectsQueryDto,
  ProjectResponse,
  toProjectResponse,
  UpdateProjectDto,
} from './dto/projects.dto';
import {
  CreateProjectRepositoryDto,
  ProjectRepositoryLinkResponse,
  toProjectRepositoryLinkResponse,
  UpdateProjectRepositoryDto,
} from './dto/project-links.dto';

// HTTP endpoints are safe to expose only because SessionAuthGuard derives the
// tenant identity from a verified session (see ChatsModule's own note).
// Controllers must never accept ownerUserId from client input.
@ApiTags('projects')
@ApiBearerAuth('bearer')
@ApiCookieAuth('cookie')
@Controller('api/v1/projects')
export class ProjectsController {
  constructor(private readonly projectsService: ProjectsService) {}

  @Post()
  @ApiOperation({ operationId: 'createProject' })
  @ApiCreatedResponse({ type: ProjectResponse })
  @ApiUnauthorizedResponse()
  async createProject(
    @CurrentUser() userId: string,
    @Body() input: CreateProjectDto,
  ): Promise<ProjectResponse> {
    const project = await this.projectsService.createProject(userId, input);
    return toProjectResponse(project);
  }

  @Get()
  @ApiOperation({ operationId: 'listProjects' })
  @ApiOkResponse({ type: ProjectResponse, isArray: true })
  @ApiUnauthorizedResponse()
  async getProjects(
    @CurrentUser() userId: string,
    @Query() query: ListProjectsQueryDto,
  ): Promise<Array<ProjectResponse>> {
    const list = await this.projectsService.listProjects(userId, query);
    return list.map(toProjectResponse);
  }

  @Get(':id')
  @ApiOperation({ operationId: 'getProject' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: ProjectResponse })
  @ApiBadRequestResponse({ description: 'Malformed project id (not a UUID)' })
  @ApiNotFoundResponse()
  @ApiUnauthorizedResponse()
  async getProjectById(
    @CurrentUser() userId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<ProjectResponse> {
    const project = await this.projectsService.getProjectById(id, userId);
    if (!project) {
      throw new NotFoundException(`Project ${id} not found`);
    }

    return toProjectResponse(project);
  }

  // PATCH (partial update) of a project resource — RESTful, not an RPC-style
  // verb endpoint (mirrors ChatsController.updateChat).
  @Patch(':id')
  @ApiOperation({ operationId: 'updateProject' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: ProjectResponse })
  @ApiBadRequestResponse({ description: 'Malformed project id (not a UUID)' })
  @ApiNotFoundResponse()
  @ApiUnauthorizedResponse()
  async updateProject(
    @CurrentUser() userId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() input: UpdateProjectDto,
  ): Promise<ProjectResponse> {
    const project = await this.projectsService.updateProject(id, userId, input);
    if (!project) {
      throw new NotFoundException(`Project ${id} not found`);
    }

    return toProjectResponse(project);
  }

  // Hard delete. Owner-scoped (RLS + ownerUserId); the FK on chats.project_id
  // is ON DELETE SET NULL, so filed chats are unfiled, never destroyed.
  @Delete(':id')
  @ApiOperation({ operationId: 'deleteProject' })
  @HttpCode(204)
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiNoContentResponse()
  @ApiBadRequestResponse({ description: 'Malformed project id (not a UUID)' })
  @ApiNotFoundResponse()
  @ApiUnauthorizedResponse()
  async deleteProject(
    @CurrentUser() userId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    const deleted = await this.projectsService.deleteProject(id, userId);
    if (!deleted) {
      throw new NotFoundException(`Project ${id} not found`);
    }
  }

  // The project's linked repositories. A read: it writes nothing, so an
  // archived project still answers.
  @Get(':id/repositories')
  @ApiOperation({
    operationId: 'listProjectRepositories',
    summary: "List a project's linked repositories",
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: ProjectRepositoryLinkResponse, isArray: true })
  @ApiBadRequestResponse({ description: 'Malformed project id (not a UUID)' })
  @ApiNotFoundResponse()
  @ApiUnauthorizedResponse()
  async listProjectRepositories(
    @CurrentUser() userId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<Array<ProjectRepositoryLinkResponse>> {
    const links = await this.projectsService.listProjectRepositories(
      userId,
      id,
    );
    return links.map(toProjectRepositoryLinkResponse);
  }

  @Post(':id/repositories')
  @ApiOperation({
    operationId: 'linkProjectRepository',
    summary: 'Link one catalog repository to a project',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiCreatedResponse({ type: ProjectRepositoryLinkResponse })
  @ApiBadRequestResponse({ description: 'Malformed project or repository id' })
  @ApiNotFoundResponse()
  @ApiConflictResponse({
    description: 'The project already links that repository',
  })
  @ApiUnauthorizedResponse()
  async linkProjectRepository(
    @CurrentUser() userId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() input: CreateProjectRepositoryDto,
  ): Promise<ProjectRepositoryLinkResponse> {
    return toProjectRepositoryLinkResponse(
      await this.projectsService.linkRepository(userId, id, input),
    );
  }

  // A partial update of one link: alias, primary flag, isolation policy.
  @Patch(':id/repositories/:repositoryId')
  @ApiOperation({
    operationId: 'updateProjectRepositoryLink',
    summary: 'Change a link alias, primary flag, or isolation policy',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiParam({ name: 'repositoryId', format: 'uuid' })
  @ApiOkResponse({ type: ProjectRepositoryLinkResponse })
  @ApiBadRequestResponse({ description: 'Malformed id or field' })
  @ApiNotFoundResponse()
  @ApiConflictResponse()
  @ApiUnauthorizedResponse()
  async updateProjectRepositoryLink(
    @CurrentUser() userId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('repositoryId', ParseUUIDPipe) repositoryId: string,
    @Body() input: UpdateProjectRepositoryDto,
  ): Promise<ProjectRepositoryLinkResponse> {
    return toProjectRepositoryLinkResponse(
      await this.projectsService.updateProjectRepository(
        userId,
        id,
        repositoryId,
        input,
      ),
    );
  }

  // Row-only unlink: the repository and its checkouts stay.
  @Delete(':id/repositories/:repositoryId')
  @ApiOperation({
    operationId: 'unlinkProjectRepository',
    summary: "Remove one repository from a project's links",
  })
  @HttpCode(204)
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiParam({ name: 'repositoryId', format: 'uuid' })
  @ApiNoContentResponse()
  @ApiBadRequestResponse({ description: 'Malformed id (not a UUID)' })
  @ApiNotFoundResponse()
  @ApiUnauthorizedResponse()
  async unlinkProjectRepository(
    @CurrentUser() userId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('repositoryId', ParseUUIDPipe) repositoryId: string,
  ): Promise<void> {
    await this.projectsService.unlinkRepository(userId, id, repositoryId);
  }
}
