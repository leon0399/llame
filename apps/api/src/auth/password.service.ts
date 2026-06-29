import { Injectable } from '@nestjs/common';
import { compare as bcryptCompare, hash as bcryptHash } from 'bcryptjs';

@Injectable()
export class PasswordService {
  hash(password: string): Promise<string> {
    return bcryptHash(password, 12);
  }

  compare(password: string, passwordHash: string): Promise<boolean> {
    return bcryptCompare(password, passwordHash);
  }
}
