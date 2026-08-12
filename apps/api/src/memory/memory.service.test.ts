import { Test } from '@nestjs/testing';

import { AppModule } from '../app.module';
import { TenantDbService } from '../db/tenant-db.service';
import { MemoryController } from './memory.controller';
import { MemoryModule } from './memory.module';
import { MemoryService } from './memory.service';

describe('MemoryModule registration', () => {
  it('registers the owner-scoped HTTP surface in AppModule', () => {
    const imports = Reflect.getMetadata('imports', AppModule) as unknown[];

    expect(imports).toContain(MemoryModule);
  });
});

describe('MemoryService', () => {
  it('resolves a missing row to the same default as an explicit opt-out', async () => {
    const runAs = vi.fn().mockResolvedValue(undefined);
    const module = await Test.createTestingModule({
      providers: [
        MemoryService,
        { provide: TenantDbService, useValue: { runAs } },
      ],
    }).compile();
    const service = module.get(MemoryService);

    await expect(service.getForOwner('owner')).resolves.toEqual({
      shareRecentChats: false,
    });
    expect(runAs).toHaveBeenCalledWith('owner', expect.any(Function));
  });

  it('exposes only explicit read and update operations, with no inference path', () => {
    expect(Object.getOwnPropertyNames(MemoryService.prototype).sort()).toEqual([
      'constructor',
      'getForOwner',
      'getForOwnerForBinding',
      'updateForOwner',
    ]);
  });
});

describe('MemoryController', () => {
  function makeController(initial = false) {
    let shareRecentChats = initial;
    const getForOwner = vi.fn(() => Promise.resolve({ shareRecentChats }));
    const updateForOwner = vi.fn(
      (_userId: string, update: { shareRecentChats?: boolean }) => {
        if (update.shareRecentChats !== undefined) {
          shareRecentChats = update.shareRecentChats;
        }
        return Promise.resolve({ shareRecentChats });
      },
    );
    const controller = new MemoryController({ getForOwner, updateForOwner });

    return { controller, getForOwner, updateForOwner };
  }

  it('preserves omitted fields and does not drop an explicit false', async () => {
    const { controller, updateForOwner } = makeController(true);

    await expect(controller.updateMemory('owner', {})).resolves.toEqual({
      shareRecentChats: true,
    });
    expect(updateForOwner).toHaveBeenLastCalledWith('owner', {});

    await expect(
      controller.updateMemory('owner', { shareRecentChats: false }),
    ).resolves.toEqual({ shareRecentChats: false });
    expect(updateForOwner).toHaveBeenLastCalledWith('owner', {
      shareRecentChats: false,
    });
  });

  it('ignores a client-supplied user id and updates only the session owner', async () => {
    const { controller, updateForOwner } = makeController();
    const input = { shareRecentChats: true, userId: 'target-user' };

    await controller.updateMemory('session-user', input);

    expect(updateForOwner).toHaveBeenCalledWith('session-user', {
      shareRecentChats: true,
    });
  });

  it('reads without inferring or changing the setting; only PATCH updates it', async () => {
    const { controller, getForOwner, updateForOwner } = makeController(false);

    await controller.getMemory('owner');
    await controller.getMemory('owner');

    expect(getForOwner).toHaveBeenCalledTimes(2);
    expect(updateForOwner).not.toHaveBeenCalled();

    await controller.updateMemory('owner', { shareRecentChats: true });
    expect(updateForOwner).toHaveBeenCalledTimes(1);
  });
});
