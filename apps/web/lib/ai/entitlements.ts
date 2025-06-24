import type { UserType } from '@/app/(auth)/auth';
import type { ChatModel } from './models';
import { languageModels } from '../../config/ai.config.mjs';

interface Entitlements {
  maxMessagesPerDay: number;
  availableChatModelIds: Array<ChatModel['id']>;
}

export const entitlementsByUserType: Record<UserType, Entitlements> = {
  /*
   * For users without an account
   */
  guest: {
    maxMessagesPerDay: 20,
    availableChatModelIds: ['grok-2-vision-1212', 'grok-3-mini-beta'],
  },

  /*
   * For users with an account
   */
  regular: {
    maxMessagesPerDay: 100,
    availableChatModelIds: Object.keys(languageModels) as Array<ChatModel['id']>,
  },

  /*
   * TODO: For users with an account and a paid membership
   */
};
