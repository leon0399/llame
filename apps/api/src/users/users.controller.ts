import { Controller, Get, Param, Post, Body } from '@nestjs/common';
import { UsersService } from './users.service';
import { User } from '../db/schema';

@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get(':id')
  async getUserById(@Param('id') id: string): Promise<User | undefined> {
    return this.usersService.getUserById(id);
  }

  @Get('email/:email')
  async getUserByEmail(
    @Param('email') email: string,
  ): Promise<User | undefined> {
    return this.usersService.getUserByEmail(email);
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
  ): Promise<User> {
    return this.usersService.createUser(userData);
  }
}
