import { Controller, Get, Param, Post, Body } from '@nestjs/common';
import { UsersService, toPublicUser, type PublicUser } from './users.service';

// SECURITY: every user returned over HTTP is projected through `toPublicUser`, which
// ALLOWLISTS safe fields — so the `password` hash and any future secret column are
// never serialized (fail closed). These endpoints are not yet authenticated /
// authorization-scoped — that lands with #60.
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get(':id')
  async getUserById(@Param('id') id: string): Promise<PublicUser | undefined> {
    const user = await this.usersService.getUserById(id);
    return user ? toPublicUser(user) : undefined;
  }

  @Get('email/:email')
  async getUserByEmail(
    @Param('email') email: string,
  ): Promise<PublicUser | undefined> {
    const user = await this.usersService.getUserByEmail(email);
    return user ? toPublicUser(user) : undefined;
  }

  @Post()
  async createUser(
    @Body()
    userData: {
      name?: string;
      email: string;
      password?: string;
      image?: string;
    },
  ): Promise<PublicUser> {
    return toPublicUser(await this.usersService.createUser(userData));
  }
}
