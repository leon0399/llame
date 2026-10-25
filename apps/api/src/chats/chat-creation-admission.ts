import {
  type Chat,
  type Checkout,
  type Project,
  type WorktreeLease,
} from '../db/schema';
import { type Db } from '../db/tenant-db.service';
import { type StartLocation } from '../projects/start-location';
import { type CreateChatRequest } from './dto/chat-creation.dto';

/*
 * The admission shapes of one chat creation (openspec `chat-start-location`,
 * design D9). They live beside the service but out of its file, so the
 * projection and the resend rules read as one unit each.
 */

/** The Chat, its project, and the location one admit decided. */
export type AdmittedChat = {
  readonly chat: Chat;
  readonly project: Project | null;
  /** The location this request resolved; null when a binding already exists. */
  readonly location: StartLocation | null;
  /** The Worktree this Chat's own creation made, which a resend reuses. */
  readonly lease: CreationLease | null;
  /**
   * The worktree directory an earlier attempt recorded before its git add,
   * when the rows that add created never committed.
   */
  readonly recordedWorktree: string | null;
  /** The executors that can run right now, as this request observed them. */
  readonly online: (executorId: string) => boolean;
};

export type CreationLease = {
  readonly lease: WorktreeLease;
  readonly checkout: Checkout;
};

/** One request's admission: its transaction, identity, request, availability. */
export type AdmitContext = {
  readonly tx: Db;
  readonly userId: string;
  readonly input: CreateChatRequest;
  readonly online: (executorId: string) => boolean;
};
