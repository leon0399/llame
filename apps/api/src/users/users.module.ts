import { Module } from '@nestjs/common';
import { UsersService } from './users.service';

// No HTTP controller: `/users` had unauthenticated GET (an email/id enumeration oracle)
// and POST (which stored the password unhashed). Now that #60 provides a guard, the safe
// move is to remove the surface entirely — UsersService is consumed internally via DI
// (AuthService). Re-expose user routes only behind the guard, owner-scoped, when needed.
@Module({
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}
