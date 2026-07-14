import { NotFoundException } from '@nestjs/common';
import { TenantDbService } from '../db/tenant-db.service';
import { PinsController } from './pins.controller';
import { PinsService } from './pins.service';
import { type PinnedRow } from './pins-repository';
import { toPinnedItemResponse } from './dto/pins.dto';

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

describe('PinsService.pin — error mapping', () => {
  // runAs just invokes the callback with a stub tx; we drive behavior by making
  // the underlying insert throw / the hydrate return undefined via the repo,
  // which we simulate by stubbing runAs directly.
  function makeService(runAsImpl: () => Promise<unknown>): PinsService {
    const tenantDb = {
      runAs: jest.fn(() => runAsImpl()),
    } as unknown as TenantDbService;
    return new PinsService(tenantDb);
  }

  it('maps a 42501 (RLS WITH CHECK denial) to 404, not 500', async () => {
    const svc = makeService(() =>
      Promise.reject(Object.assign(new Error('rls'), { code: '42501' })),
    );
    await expect(svc.pin('u1', 'chat', 'c1')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('maps a nested cause 42501 to 404', async () => {
    const svc = makeService(() =>
      Promise.reject(
        Object.assign(new Error('rls'), { cause: { code: '42501' } }),
      ),
    );
    await expect(svc.pin('u1', 'project', 'p1')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('maps an undefined hydrated row (re-pin of now-inaccessible item) to 404', async () => {
    const svc = makeService(() => Promise.resolve(undefined));
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
    const svc = makeService(() => Promise.resolve(row));
    await expect(svc.pin('u1', 'chat', 'c1')).resolves.toEqual(row);
  });

  it('rethrows an unexpected (non-42501) error unchanged', async () => {
    const boom = Object.assign(new Error('boom'), { code: '08006' });
    const svc = makeService(() => Promise.reject(boom));
    await expect(svc.pin('u1', 'chat', 'c1')).rejects.toBe(boom);
  });
});

describe('PinsController', () => {
  it('GET /pins maps service rows to PinnedItemResponse[]', async () => {
    const rows: PinnedRow[] = [
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
    const listPins = jest.fn().mockResolvedValue(rows);
    const service = { listPins } as unknown as PinsService;
    const controller = new PinsController(service);

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
    const pin = jest.fn().mockResolvedValue(row);
    const service = { pin } as unknown as PinsService;
    const controller = new PinsController(service);

    const out = await controller.pin('u1', 'chat', 'c1');
    expect(out.item).toEqual({ id: 'c1', title: 'C', archivedAt: null });
    expect(pin).toHaveBeenCalledWith('u1', 'chat', 'c1');
  });

  it('DELETE delegates to the service and returns void', async () => {
    const unpin = jest.fn().mockResolvedValue(undefined);
    const service = { unpin } as unknown as PinsService;
    const controller = new PinsController(service);

    await expect(
      controller.unpin('u1', 'project', 'p1'),
    ).resolves.toBeUndefined();
    expect(unpin).toHaveBeenCalledWith('u1', 'project', 'p1');
  });
});
