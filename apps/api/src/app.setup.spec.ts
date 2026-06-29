import { ArgumentMetadata, ValidationPipe } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import { configureApp } from './app.setup';
import { RegisterDto } from './auth/dto/auth.dto';

describe('configureApp', () => {
  it('installs a fail-closed global ValidationPipe', () => {
    const useGlobalPipes = jest.fn();
    const app = {
      useGlobalPipes,
    } as unknown as INestApplication;

    configureApp(app);

    expect(useGlobalPipes).toHaveBeenCalledWith(expect.any(ValidationPipe));
    const [[pipe]] = useGlobalPipes.mock.calls as [[ValidationPipe]];
    expect(
      (pipe as unknown as { validatorOptions: unknown }).validatorOptions,
    ).toMatchObject({
      whitelist: true,
      forbidNonWhitelisted: true,
    });
  });

  it('rejects unknown auth DTO fields with 400-class validation errors', async () => {
    const pipe = new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    });
    const metadata: ArgumentMetadata = {
      type: 'body',
      metatype: RegisterDto,
    };

    await expect(
      pipe.transform(
        {
          email: 'alice@example.com',
          password: 'password123',
          extra: 'reject me',
        },
        metadata,
      ),
    ).rejects.toMatchObject({ status: 400 });
  });
});
