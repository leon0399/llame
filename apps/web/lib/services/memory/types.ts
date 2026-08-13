/**
 * Mirrors `MemoryResponse` / `UpdateMemoryDto` in
 * `apps/api/src/memory/dto/memory.dto.ts`.
 */
export type MemorySettings = {
  /** Whether recent-chat titles and opening excerpts may be shared. */
  shareRecentChats: boolean;
};

/** A partial owner-scoped update; omitted fields retain their stored value. */
export type MemorySettingsUpdate = Partial<MemorySettings>;
