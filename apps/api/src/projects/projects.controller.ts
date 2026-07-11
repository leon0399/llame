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
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiParam,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { CurrentUser } from '../auth/auth-context';
import { ProjectsService } from './projects.service';
import {
  CreateProjectDto,
  ProjectResponse,
  toProjectResponse,
  UpdateProjectDto,
} from './dto/projects.dto';

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
  @ApiOkResponse({ type: ProjectResponse, isArray: true })
  @ApiUnauthorizedResponse()
  async getProjects(@CurrentUser() userId: string): Promise<ProjectResponse[]> {
    const list = await this.projectsService.listProjects(userId);
    return list.map(toProjectResponse);
  }

  @Get(':id')
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
    const deleted = await this.projectsService.deleteProject(userId, id);
    if (!deleted) {
      throw new NotFoundException(`Project ${id} not found`);
    }
  }
}
