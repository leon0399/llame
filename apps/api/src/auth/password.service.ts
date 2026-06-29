import { Injectable } from '@nestjs/common';

type BcryptTs = typeof import('bcrypt-ts');

// bcrypt-ts exposes a CJS build, but Jest resolves the package entry to ESM even
// through require(). Resolve the package path, then load the sibling CJS file.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const bcrypt = require(
  require.resolve('bcrypt-ts').replace(/node\.mjs$/, 'node.cjs'),
) as BcryptTs;

@Injectable()
export class PasswordService {
  hash(password: string): Promise<string> {
    return bcrypt.hash(password, 12);
  }

  compare(password: string, passwordHash: string): Promise<boolean> {
    return bcrypt.compare(password, passwordHash);
  }
}
