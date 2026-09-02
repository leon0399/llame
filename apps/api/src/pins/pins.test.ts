import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { TenantDbService } from '../db/tenant-db.service';
import { PinsController } from './pins.controller';
import { PinsService } from './pins.service';
import { PinReorderMismatchError, type PinnedRow } from './pins-repository';
import { ReorderPinsDto, toPinnedItemResponse } from './dto/pins.dto';

type PinsControllerServiceDouble = Partial<
  Pick<PinsService, 'listPins' | 'reorderPins' | 'pin' | 'unpin'>
>;

describe('toPinnedItemResponse', () => {
  it('maps a chat row to a ChatRefCard item ({id, title})', () => {
    const row: PinnedRow = {
      itemType: 'chat',
      itemId: 'c1',
      pinnedAt: new Date('2026-07-12T00:00:00Z'),
      title: 'Hello',
      archivedAt: null,
    };
    expect(toPinnedItemResponse(row)).toEqual({
      itemType: 'chat',
      itemId: 'c1',
      pinnedAt: row.pinnedAt,
      item: { id: 'c1', title: 'Hello', archivedAt: null },
    });
  });

  it('carries a null chat title through (untitled chat)', () => {
    const row: PinnedRow = {
      itemType: 'chat',
      itemId: 'c2',
      pinnedAt: new Date(),
      title: null,
      archivedAt: null,
    };
    expect(toPinnedItemResponse(row).item).toEqual({
      id: 'c2',
      title: null,
      archivedAt: null,
    });
  });

  it('maps a project row to a ProjectRefCard item ({id, name})', () => {
    const row: PinnedRow = {
      itemType: 'project',
      itemId: 'p1',
      pinnedAt: new Date(),
      name: 'Acme',
      archivedAt: null,
    };
    expect(toPinnedItemResponse(row).item).toEqual({
      id: 'p1',
      name: 'Acme',
      archivedAt: null,
    });
  });
});

describe('ReorderPinsDto', () => {
  it('rejects malformed array entries without throwing from validation', async () => {
    const dto = plainToInstance(ReorderPinsDto, { items: [null] });

    await expect(validate(dto)).resolves.not.toEqual([]);
  });
});

describe('PinsService.pin — error mapping', () => {
  // runAs just invokes the callback with a stub tx; we drive behavior by making
  // the underlying insert throw / the hydrate return undefined via the repo,
  // which we simulate by stubbing runAs directly.
  async function makeService(
    runAsImpl: () => Promise<PinnedRow | undefined>,
  ): Promise<PinsService> {
    const moduleRef = await Test.createTestingModule({
      providers: [
        PinsService,
        {
          provide: TenantDbService,
          useValue: { runAs: vi.fn(() => runAsImpl()) },
        },
      ],
    }).compile();
    return moduleRef.get(PinsService);
  }

  it('maps a 42501 (RLS WITH CHECK denial) to 404, not 500', async () => {
    const svc = await makeService(() =>
      Promise.reject(Object.assign(new Error('rls'), { code: '42501' })),
    );
    await expect(svc.pin('u1', 'chat', 'c1')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('maps a nested cause 42501 to 404', async () => {
    const svc = await makeService(() =>
      Promise.reject(
        Object.assign(new Error('rls'), { cause: { code: '42501' } }),
      ),
    );
    await expect(svc.pin('u1', 'project', 'p1')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('maps an undefined hydrated row (re-pin of now-inaccessible item) to 404', async () => {
    const svc = await makeService(() => Promise.resolve(undefined));
    await expect(svc.pin('u1', 'chat', 'c1')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('returns the hydrated row on success', async () => {
    const row: PinnedRow = {
      itemType: 'chat',
      itemId: 'c1',
      pinnedAt: new Date(),
      title: 'ok',
      archivedAt: null,
    };
    const svc = await makeService(() => Promise.resolve(row));
    await expect(svc.pin('u1', 'chat', 'c1')).resolves.toEqual(row);
  });

  it('rethrows an unexpected (non-42501) error unchanged', async () => {
    const boom = Object.assign(new Error('boom'), { code: '08006' });
    const svc = await makeService(() => Promise.reject(boom));
    await expect(svc.pin('u1', 'chat', 'c1')).rejects.toBe(boom);
  });

  it('retries once when two pins race on position unique (23505)', async () => {
    const row: PinnedRow = {
      itemType: 'chat',
      itemId: 'c1',
      pinnedAt: new Date(),
      title: 'ok',
      archivedAt: null,
    };
    const runAs = vi
      .fn()
      .mockRejectedValueOnce(
        Object.assign(new Error('uniq'), { code: '23505' }),
      )
      .mockResolvedValueOnce(row);
    const moduleRef = await Test.createTestingModule({
      providers: [
        PinsService,
        { provide: TenantDbService, useValue: { runAs } },
      ],
    }).compile();
    const svc = moduleRef.get(PinsService);

    await expect(svc.pin('u1', 'chat', 'c1')).resolves.toEqual(row);
    expect(runAs).toHaveBeenCalledTimes(2);
  });
});

describe('PinsService.reorderPins — error mapping', () => {
  it('maps an exact-set mismatch to 400', async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        PinsService,
        {
          provide: TenantDbService,
          useValue: {
            runAs: vi.fn(() => Promise.reject(new PinReorderMismatchError())),
          },
        },
      ],
    }).compile();

    await expect(
      moduleRef
        .get(PinsService)
        .reorderPins('u1', [{ itemType: 'chat', itemId: 'c1' }]),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('PinsController', () => {
  async function makeController(
    service: PinsControllerServiceDouble,
  ): Promise<PinsController> {
    const moduleRef = await Test.createTestingModule({
      controllers: [PinsController],
      providers: [{ provide: PinsService, useValue: service }],
    }).compile();
    return moduleRef.get(PinsController);
  }

  it('GET /pins maps service rows to PinnedItemResponse[]', async () => {
    const rows: Array<PinnedRow> = [
      {
        itemType: 'project',
        itemId: 'p1',
        pinnedAt: new Date(),
        name: 'P',
        archivedAt: null,
      },
      {
        itemType: 'chat',
        itemId: 'c1',
        pinnedAt: new Date(),
        title: 'C',
        archivedAt: null,
      },
    ];
    const listPins = vi.fn().mockResolvedValue(rows);
    const service = { listPins };
    const controller = await makeController(service);

    const out = await controller.listPins('u1');
    expect(out).toHaveLength(2);
    expect(out[0].item).toEqual({ id: 'p1', name: 'P', archivedAt: null });
    expect(out[1].item).toEqual({ id: 'c1', title: 'C', archivedAt: null });
    expect(listPins).toHaveBeenCalledWith('u1');
  });

  it('PUT returns the mapped pinned item', async () => {
    const row: PinnedRow = {
      itemType: 'chat',
      itemId: 'c1',
      pinnedAt: new Date(),
      title: 'C',
      archivedAt: null,
    };
    const pin = vi.fn().mockResolvedValue(row);
    const service = { pin };
    const controller = await makeController(service);

    const out = await controller.pin('u1', 'chat', 'c1');
    expect(out.item).toEqual({ id: 'c1', title: 'C', archivedAt: null });
    expect(pin).toHaveBeenCalledWith('u1', 'chat', 'c1');
  });

  it('PUT /pins/order delegates the complete order and maps the returned list', async () => {
    const rows: Array<PinnedRow> = [
      {
        itemType: 'project',
        itemId: 'p1',
        pinnedAt: new Date(),
        name: 'Project',
        archivedAt: null,
      },
      {
        itemType: 'chat',
        itemId: 'c1',
        pinnedAt: new Date(),
        title: 'Chat',
        archivedAt: null,
      },
    ];
    const reorderPins = vi.fn().mockResolvedValue(rows);
    const controller = await makeController({ reorderPins });
    const body = {
      items: [
        { itemType: 'project' as const, itemId: 'p1' },
        { itemType: 'chat' as const, itemId: 'c1' },
      ],
    };

    const out = await controller.reorderPins('u1', body);

    expect(out.map(({ itemId }) => itemId)).toEqual(['p1', 'c1']);
    expect(reorderPins).toHaveBeenCalledWith('u1', body.items);
  });

  it('DELETE delegates to the service and returns void', async () => {
    const unpin = vi.fn().mockResolvedValue(undefined);
    const service = { unpin };
    const controller = await makeController(service);

    await expect(
      controller.unpin('u1', 'project', 'p1'),
    ).resolves.toBeUndefined();
    expect(unpin).toHaveBeenCalledWith('u1', 'project', 'p1');
  });
});
