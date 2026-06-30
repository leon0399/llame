import { ArgumentMetadata, ValidationPipe } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import { configureApp } from './app.setup';
import { RegisterDto } from './auth/dto/auth.dto';

describe('configureApp', () => {
  it('installs a fail-closed global ValidationPipe', () => {
    const useGlobalPipes = jest.fn();
    const enableCors = jest.fn();
    const app = {
      useGlobalPipes,
      enableCors,
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

  it('enables credentialed CORS for the configured web origin allowlist', () => {
    const originalWebOrigin = process.env.WEB_ORIGIN;
    process.env.WEB_ORIGIN =
      'https://app.example.com, https://admin.example.com';

    const useGlobalPipes = jest.fn();
    const enableCors = jest.fn();
    const app = {
      useGlobalPipes,
      enableCors,
    } as unknown as INestApplication;

    try {
      configureApp(app);
    } finally {
      if (originalWebOrigin === undefined) {
        delete process.env.WEB_ORIGIN;
      } else {
        process.env.WEB_ORIGIN = originalWebOrigin;
      }
    }

    expect(enableCors).toHaveBeenCalledWith({
      origin: ['https://app.example.com', 'https://admin.example.com'],
      credentials: true,
    });
  });

  it('fails closed in production when no web origin allowlist is configured', () => {
    const originalNodeEnv = process.env.NODE_ENV;
    const originalWebOrigin = process.env.WEB_ORIGIN;
    process.env.NODE_ENV = 'production';
    delete process.env.WEB_ORIGIN;

    const app = {
      useGlobalPipes: jest.fn(),
      enableCors: jest.fn(),
    } as unknown as INestApplication;

    try {
      expect(() => configureApp(app)).toThrow(/WEB_ORIGIN/);
    } finally {
      if (originalNodeEnv === undefined) {
        delete process.env.NODE_ENV;
      } else {
        process.env.NODE_ENV = originalNodeEnv;
      }
      if (originalWebOrigin === undefined) {
        delete process.env.WEB_ORIGIN;
      } else {
        process.env.WEB_ORIGIN = originalWebOrigin;
      }
    }
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
