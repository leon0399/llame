import { ArgumentMetadata, ValidationPipe } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import { configureApp, getTrustProxySetting } from './app.setup';
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

  it('fails closed when a web origin carries a path or trailing slash', () => {
    const originalWebOrigin = process.env.WEB_ORIGIN;
    const app = {
      useGlobalPipes: jest.fn(),
      enableCors: jest.fn(),
    } as unknown as INestApplication;

    try {
      for (const bad of [
        'https://app.example.com/',
        'https://app.example.com/path',
        'app.example.com',
      ]) {
        process.env.WEB_ORIGIN = bad;
        expect(() => configureApp(app)).toThrow(/WEB_ORIGIN entry/);
      }
    } finally {
      if (originalWebOrigin === undefined) {
        delete process.env.WEB_ORIGIN;
      } else {
        process.env.WEB_ORIGIN = originalWebOrigin;
      }
    }
  });

  it('fails closed when the web origin allowlist is a wildcard', () => {
    const originalWebOrigin = process.env.WEB_ORIGIN;
    process.env.WEB_ORIGIN = '*';

    const app = {
      useGlobalPipes: jest.fn(),
      enableCors: jest.fn(),
    } as unknown as INestApplication;

    try {
      expect(() => configureApp(app)).toThrow(/\*/);
    } finally {
      if (originalWebOrigin === undefined) {
        delete process.env.WEB_ORIGIN;
      } else {
        process.env.WEB_ORIGIN = originalWebOrigin;
      }
    }
  });

  it('does not touch the Express trust-proxy setting when no trustProxy value is resolved', () => {
    const getHttpAdapter = jest.fn();
    const app = {
      useGlobalPipes: jest.fn(),
      enableCors: jest.fn(),
      getHttpAdapter,
    } as unknown as INestApplication;

    configureApp(app, null);

    expect(getHttpAdapter).not.toHaveBeenCalled();
  });

  it('applies the resolved trustProxy value to the Express instance', () => {
    const set = jest.fn();
    const getHttpAdapter = jest.fn(() => ({
      getInstance: () => ({ set }),
    }));
    const app = {
      useGlobalPipes: jest.fn(),
      enableCors: jest.fn(),
      getHttpAdapter,
    } as unknown as INestApplication;

    configureApp(app, '1');

    expect(set).toHaveBeenCalledWith('trust proxy', 1);
  });

  describe('getTrustProxySetting', () => {
    it('treats null, undefined, or blank as unset (undefined)', () => {
      expect(getTrustProxySetting(null)).toBeUndefined();
      expect(getTrustProxySetting(undefined)).toBeUndefined();
      expect(getTrustProxySetting('  ')).toBeUndefined();
    });

    it('parses true/false as booleans, forwarding only true', () => {
      expect(getTrustProxySetting('true')).toBe(true);
      expect(getTrustProxySetting('TRUE')).toBe(true);
      expect(getTrustProxySetting('false')).toBeUndefined();
    });

    it('parses a non-negative integer as a hop count', () => {
      expect(getTrustProxySetting('1')).toBe(1);
      expect(getTrustProxySetting('0')).toBe(0);
    });

    it('rejects a negative or non-integer hop count', () => {
      expect(() => getTrustProxySetting('-1')).toThrow(/TRUST_PROXY/);
      expect(() => getTrustProxySetting('1.5')).toThrow(/TRUST_PROXY/);
    });

    it('forwards an Express subnet spec verbatim', () => {
      expect(getTrustProxySetting('loopback')).toBe('loopback');
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
