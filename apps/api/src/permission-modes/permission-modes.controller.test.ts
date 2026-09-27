import type { INestApplication } from '@nestjs/common';
import type { Server } from 'node:http';
import { Test } from '@nestjs/testing';
import { APP_GUARD, Reflector } from '@nestjs/core';
import request from 'supertest';

import { AuthService } from '../auth/auth.service';
import { SessionAuthGuard } from '../auth/session-auth.guard';
import { BUILT_IN_DEFAULTS } from '../instance-config/llame-config';
import {
  InstanceConfigService,
  type InstanceConfigReader,
} from '../instance-config/instance-config.service';
import type { PermissionMode } from '../tools/permissions/permission-mode';
import { PermissionModesController } from './permission-modes.controller';

describe('PermissionModesController', () => {
  function makeInstanceConfig(
    permissionModes: ReadonlyArray<PermissionMode> = ['default'],
  ): InstanceConfigReader {
    return {
      config: {
        ...BUILT_IN_DEFAULTS,
        tools: {
          ...BUILT_IN_DEFAULTS.tools,
          permissionModes,
        },
      },
    };
  }

  function makeController(
    permissionModes: ReadonlyArray<PermissionMode> = ['default'],
  ) {
    return new PermissionModesController(makeInstanceConfig(permissionModes));
  }

  it('returns the default mode', () => {
    const response = makeController().listPermissionModes();

    expect(response).toEqual({ modes: [{ value: 'default' }] });
  });

  it('returns enabled modes in configuration order', () => {
    const response = makeController([
      'default',
      'bypass',
    ]).listPermissionModes();

    expect(response).toEqual({
      modes: [{ value: 'default' }, { value: 'bypass' }],
    });
  });

  it('requires a session', async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [PermissionModesController],
      providers: [
        {
          provide: InstanceConfigService,
          useValue: makeInstanceConfig(),
        },
        {
          provide: AuthService,
          useValue: { validateToken: vi.fn() },
        },
        {
          provide: Reflector,
          useValue: { getAllAndOverride: vi.fn().mockReturnValue(false) },
        },
        { provide: APP_GUARD, useClass: SessionAuthGuard },
      ],
    }).compile();
    const app: INestApplication<Server> = moduleRef.createNestApplication();

    try {
      await app.init();
      await request(app.getHttpServer())
        .get('/api/v1/permission-modes')
        .expect(401);
    } finally {
      await app.close();
    }
  });
});
