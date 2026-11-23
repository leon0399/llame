/**
 * The switch's hold write (design D4): a hold lands only when the owner has
 * not chosen since the Run read its revision, and its instant is stored as the
 * ISO value admission later compares. See OpenSpec `model-roles`: "A switch
 * holds the Chat on the new candidate".
 */

import type { ChatModelSelection } from '../models/model-selection';
import type { ChatsRepository } from './chats-repository';
import { writeSwitchHold, type SwitchHoldInput } from './selection-update';

const SELECTION: ChatModelSelection = {
  revision: 3,
  selector: '@coding',
  effort: 'xhigh',
};

const INPUT: SwitchHoldInput = {
  runSelectionRevision: 3,
  runSelector: '@coding',
  modelId: 'sonnet',
  effort: 'medium',
  revertAt: new Date('2026-11-23T14:00:00.000Z'),
};

function fakeChats() {
  const setModelSelection = vi.fn<ChatsRepository['setModelSelection']>(() =>
    Promise.resolve(),
  );

  return { setModelSelection };
}

describe('writeSwitchHold', () => {
  it('writes the hold at the same revision when the selector still matches', async () => {
    const chats = fakeChats();

    const wrote = await writeSwitchHold(
      chats,
      { id: 'chat-1', ownerUserId: 'owner-1', modelSelection: SELECTION },
      INPUT,
    );

    expect(wrote).toBe(true);
    expect(chats.setModelSelection).toHaveBeenCalledWith('chat-1', 'owner-1', {
      revision: 3,
      selector: '@coding',
      effort: 'xhigh',
      hold: {
        selector: '@coding',
        modelId: 'sonnet',
        effort: 'medium',
        revertAt: '2026-11-23T14:00:00.000Z',
      },
    });
  });

  it('keeps the owner pick when the revision moved', async () => {
    const chats = fakeChats();

    const wrote = await writeSwitchHold(
      chats,
      {
        id: 'chat-1',
        ownerUserId: 'owner-1',
        modelSelection: { ...SELECTION, revision: 4, selector: '@fast' },
      },
      INPUT,
    );

    expect(wrote).toBe(false);
    expect(chats.setModelSelection).not.toHaveBeenCalled();
  });

  it('keeps the selection when the revision is the same but the selector differs', async () => {
    const chats = fakeChats();

    const wrote = await writeSwitchHold(
      chats,
      {
        id: 'chat-1',
        ownerUserId: 'owner-1',
        modelSelection: { ...SELECTION, selector: '@fast' },
      },
      INPUT,
    );

    expect(wrote).toBe(false);
    expect(chats.setModelSelection).not.toHaveBeenCalled();
  });

  it('writes no hold when the Chat stores no selection', async () => {
    const chats = fakeChats();

    const wrote = await writeSwitchHold(
      chats,
      { id: 'chat-1', ownerUserId: 'owner-1', modelSelection: null },
      INPUT,
    );

    expect(wrote).toBe(false);
    expect(chats.setModelSelection).not.toHaveBeenCalled();
  });
});
