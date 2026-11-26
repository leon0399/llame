/**
 * The Machine identity bind over real Postgres and the real protocol peer: the
 * installation binds a Machine name to the first daemon instance id that
 * answers, a second box answering under the same name is refused before it
 * sees a request, and a request waits while the very first bind is still in
 * flight.
 *
 * The role topology is the integration suite's
 * (vitest.integration.global-setup.mts): the binding table is readable only in
 * the marked system context, which is exactly what `MachineBindingsRepository`
 * enters. Requires POSTGRES_URL to point at a migrated database, which the
 * integration project's global setup provides
 * (vitest.integration.global-setup.mts).
 */

import { drizzle } from 'drizzle-orm/postgres-js';
import postgres, { type Sql } from 'postgres';

import {
  type JsonValue,
  type MachineMethod,
  type MachineMethodParams,
} from '@workspace/machine-protocol';

import {
  createProtocolPeer,
  type ProtocolPeer,
} from '../testing/machine-protocol-peer';

import type { MachineRequestOptions } from './machine-session';
import type { MachineTransportFactory } from './machine-transport';
import { MachineBindingsRepository } from './machine-bindings.repository';
import {
  MachineConnector,
  type MachineConnectorDeps,
} from './machine-connector.service';
import { MachineIdentityMismatchError } from './machine-session-errors';
import type { MachineContact } from './machines-status';

type SqlClient = Sql;

const NAME = 'integration-identity';
const INSTANCE_A = '00000000-0000-4000-8000-0000000000b1';
const INSTANCE_B = '00000000-0000-4000-8000-0000000000b2';
const ENVELOPE = { budgetMs: 30_000 };
const ROOTS_LIST_ANSWER = { value: { roots: ['/srv/app'] } };

const MACHINES = {
  ssh: { knownHostsFile: '/etc/llame/machine_known_hosts' },
  hosts: { [NAME]: { destination: 'box' } },
};

/** One peer per daemon the connector opens, in order. */
function transportOf(
  peers: ReadonlyArray<ProtocolPeer>,
): MachineTransportFactory {
  let opened = 0;
  let active: ProtocolPeer | undefined;

  return {
    requestHandler: (
      method: MachineMethod,
      params: MachineMethodParams,
      options: MachineRequestOptions,
    ) => {
      const handler = active?.factory.requestHandler;

      if (handler === undefined) {
        throw new Error('the suite has no active peer request handler');
      }

      return handler(method, params, options);
    },
    streamHandler: (invocation) => {
      const handler = active?.factory.streamHandler;

      if (handler === undefined) {
        return Promise.reject(
          new Error('the suite has no active peer stream handler'),
        );
      }

      return handler(invocation);
    },
    open: (request) => {
      const peer = peers[Math.min(opened, peers.length - 1)];

      opened += 1;

      if (peer === undefined) throw new Error('the suite has no peer left');
      active = peer;

      return peer.factory.open(request);
    },
  };
}

/** Let the connector's own session and promise callbacks run. */
async function settle(): Promise<void> {
  for (let turn = 0; turn < 2; turn += 1) {
    const settled = Promise.withResolvers<void>();

    setImmediate(settled.resolve);
    await settled.promise;
  }
}

describe('Machine identity binding over the real bindings table', () => {
  let sql: SqlClient;
  let bindings: MachineBindingsRepository;

  beforeAll(() => {
    sql = postgres(process.env.POSTGRES_URL!, { max: 4 });
    bindings = new MachineBindingsRepository(drizzle({ client: sql }));
  });

  afterAll(async () => {
    // Through the repository: a plain identity-less statement is filtered to
    // nothing by the system policy.
    if (bindings !== undefined) await bindings.forget(NAME);

    if (sql) await sql.end();
  });

  beforeEach(async () => {
    await bindings.forget(NAME);
  });

  it('refuses a second instance under a bound name, before any request', async () => {
    const contacts: Array<MachineContact> = [];

    const first = createProtocolPeer({
      instanceId: INSTANCE_A,
      answers: { 'roots.list': ROOTS_LIST_ANSWER },
    });

    const second = createProtocolPeer({
      instanceId: INSTANCE_B,
      answers: { 'roots.list': ROOTS_LIST_ANSWER },
    });

    const connector = new MachineConnector({
      machines: MACHINES,
      hubVersion: '9.9.9',
      transportFactory: transportOf([first, second]),
      bindIdentity: (name, instanceId) =>
        bindings.bindOrCompare(name, instanceId),
      onContact: (contact) => {
        contacts.push(contact);
      },
      handshakeTimeoutMs: 2000,
    });

    try {
      await expect(
        connector.request(NAME, 'roots.list', { envelope: ENVELOPE }),
      ).resolves.toEqual({ roots: ['/srv/app'] });

      const firstSession = await first.session(0);
      expect(firstSession.requests).toEqual(['roots.list']);
      await expect(bindings.bindOrCompare(NAME, INSTANCE_A)).resolves.toBe(
        'match',
      );

      // The bound daemon goes away, and another box answers under its name.
      firstSession.drop();
      await settle();

      const error = await connector
        .request(NAME, 'roots.list', { envelope: ENVELOPE })
        .catch((error: unknown) => error);

      expect(error).toBeInstanceOf(MachineIdentityMismatchError);
      const secondSession = await second.session(0);
      // The handshake answered, and not one request reached the daemon.
      expect(secondSession.requests).toEqual([]);
      await vi.waitFor(() => {
        expect(contacts).toContainEqual(
          expect.objectContaining({ failure: 'identity_mismatch' }),
        );
      });
      // The mismatch changed nothing: the name stays bound to the first id.
      await expect(bindings.bindOrCompare(NAME, INSTANCE_A)).resolves.toBe(
        'match',
      );
    } finally {
      connector.onModuleDestroy();
    }
  });

  it('holds a request until the first bind commits', async () => {
    const bound = Promise.withResolvers<void>();
    const gate = Promise.withResolvers<void>();

    const peer = createProtocolPeer({
      instanceId: INSTANCE_A,
      answers: { 'roots.list': ROOTS_LIST_ANSWER },
    });

    let bindCalls = 0;

    const bindIdentity: MachineConnectorDeps['bindIdentity'] = async (
      name,
      instanceId,
    ) => {
      bindCalls += 1;

      // Hold the FIRST bind, so both requests are asked while it is pending.
      if (bindCalls === 1) {
        bound.resolve();
        await gate.promise;
      }

      return bindings.bindOrCompare(name, instanceId);
    };

    const connector = new MachineConnector({
      machines: MACHINES,
      hubVersion: '9.9.9',
      transportFactory: peer.factory,
      bindIdentity,
      handshakeTimeoutMs: 2000,
    });

    try {
      const first = connector.request(NAME, 'roots.list', {
        envelope: ENVELOPE,
      });

      // The handshake is answered, so only the bind keeps the session from
      // serving.
      await bound.promise;

      const second = connector.request(NAME, 'roots.list', {
        envelope: ENVELOPE,
      });

      const session = await peer.session(0);

      await settle();
      expect(session.requests).toEqual([]);

      gate.resolve();
      const answers: Array<JsonValue> = await Promise.all([first, second]);

      expect(answers).toEqual([
        { roots: ['/srv/app'] },
        { roots: ['/srv/app'] },
      ]);
      expect(session.requests).toEqual(['roots.list', 'roots.list']);
      await expect(bindings.bindOrCompare(NAME, INSTANCE_A)).resolves.toBe(
        'match',
      );
    } finally {
      connector.onModuleDestroy();
    }
  });
});
