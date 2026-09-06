"use client";

import { useRouter } from "next/navigation";

import type { ChatStatus, UIMessage } from "ai";

import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from "@workspace/ui/components/ai-elements/conversation";
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@workspace/ui/components/alert";

import { ChatLoadOlder } from "./chat-load-older";
import { CompactionBoundary } from "./compaction-boundary";
import { ChatMessageRow, messageBoundaries } from "./chat-message-row";
import { messageRenderKey, type Compaction } from "@/lib/services/chat/history";
import type { AvailableModel } from "@/lib/services/models/queries";

type ChatTranscriptMessageProps = {
  chatId: string;
  message: UIMessage;
  index: number;
  compaction: Compaction | null;
  compactionIndex: number;
  availableModels: ReadonlyArray<AvailableModel>;
  status: ChatStatus;
  onInspectContext: (runId: string) => void;
  onForked: (forkedChatId: string) => void;
};

/** One row's boundary computation plus its `ChatMessageRow` — split out of
 *  `ChatTranscriptMessages` as its own self-contained region. */
function ChatTranscriptMessage({
  chatId,
  message,
  index,
  compaction,
  compactionIndex,
  availableModels,
  status,
  onInspectContext,
  onForked,
}: ChatTranscriptMessageProps) {
  const renderKey = messageRenderKey(message);
  const { boundary, modelBoundary } = messageBoundaries({
    message,
    index,
    compaction,
    compactionIndex,
    availableModels,
    onInspectContext,
  });

  return (
    <ChatMessageRow
      renderKey={renderKey}
      message={message}
      boundary={boundary}
      modelBoundary={modelBoundary}
      availableModels={availableModels}
      chatId={chatId}
      status={status}
      onForked={onForked}
      onInspectContext={onInspectContext}
    />
  );
}

type ChatTranscriptCompactionBoundaryProps = {
  compaction: Compaction;
  availableModels: ReadonlyArray<AvailableModel>;
};

/** The trailing compaction boundary, shown when it lands after the last
 *  loaded message. Split out of `ChatTranscriptMessages` as its own
 *  self-contained region. */
function ChatTranscriptCompactionBoundary({
  compaction,
  availableModels,
}: ChatTranscriptCompactionBoundaryProps) {
  return (
    <div className="mx-auto w-full max-w-3xl md:px-6">
      <CompactionBoundary
        summary={compaction.summary}
        createdAt={compaction.createdAt}
        stats={compaction.stats}
        models={availableModels}
      />
    </div>
  );
}

type ChatTranscriptMessagesProps = {
  chatId: string;
  displayMessages: Array<UIMessage>;
  compaction: Compaction | null;
  compactionIndex: number;
  availableModels: ReadonlyArray<AvailableModel>;
  status: ChatStatus;
  onInspectContext: (runId: string) => void;
};

/** Every message row, plus the trailing compaction boundary when it lands
 *  after the last loaded message. Split out of `ChatTranscript` as its own
 *  self-contained region. */
function ChatTranscriptMessages({
  chatId,
  displayMessages,
  compaction,
  compactionIndex,
  availableModels,
  status,
  onInspectContext,
}: ChatTranscriptMessagesProps) {
  const router = useRouter();

  return (
    <>
      {displayMessages.map((message, index) => (
        <ChatTranscriptMessage
          key={`message-${messageRenderKey(message)}`}
          chatId={chatId}
          message={message}
          index={index}
          compaction={compaction}
          compactionIndex={compactionIndex}
          availableModels={availableModels}
          status={status}
          onInspectContext={onInspectContext}
          onForked={(forkedChatId) => router.push(`/chat/${forkedChatId}`)}
        />
      ))}
      {/* All loaded messages are within the summarized span → boundary sits
          after the last one. */}
      {compaction && compactionIndex === displayMessages.length && (
        <ChatTranscriptCompactionBoundary
          compaction={compaction}
          availableModels={availableModels}
        />
      )}
    </>
  );
}

/** The send/stream error alert. Split out of `ChatTranscriptBody` as its
 *  own self-contained region. */
function ChatTranscriptErrorAlert({ error }: { error: Error }) {
  return (
    <div className="max-w-3xl mx-auto">
      <Alert variant={"destructive"} className="w-full">
        <AlertTitle>Error: {error.name}</AlertTitle>
        <AlertDescription className="text-sm">{error.message}</AlertDescription>
      </Alert>
    </div>
  );
}

type ChatTranscriptProps = {
  chatId: string;
  displayMessages: Array<UIMessage>;
  compaction: Compaction | null;
  compactionIndex: number;
  hasOlderMessages: boolean;
  isLoadingOlderMessages: boolean;
  onLoadOlderMessages: () => void;
  availableModels: ReadonlyArray<AvailableModel>;
  status: ChatStatus;
  displayedError: Error | undefined;
  onInspectContext: (runId: string) => void;
};

/** The scrollable region's content: older-page loading, every message row,
 *  and a send/stream error. Split out of `ChatTranscript` as its own
 *  self-contained region — reuses its parent's full prop set. */
function ChatTranscriptBody({
  chatId,
  displayMessages,
  compaction,
  compactionIndex,
  hasOlderMessages,
  isLoadingOlderMessages,
  onLoadOlderMessages,
  availableModels,
  status,
  displayedError,
  onInspectContext,
}: ChatTranscriptProps) {
  return (
    <>
      <ChatLoadOlder
        hasOlder={hasOlderMessages}
        isLoading={isLoadingOlderMessages}
        onLoadOlder={onLoadOlderMessages}
        oldestMessageKey={
          displayMessages.length > 0
            ? messageRenderKey(displayMessages[0])
            : null
        }
      />
      <ChatTranscriptMessages
        chatId={chatId}
        displayMessages={displayMessages}
        compaction={compaction}
        compactionIndex={compactionIndex}
        availableModels={availableModels}
        status={status}
        onInspectContext={onInspectContext}
      />
      {displayedError && <ChatTranscriptErrorAlert error={displayedError} />}
    </>
  );
}

/** The scrollable message log. Split out of `ChatSessionContent` as its own
 *  self-contained region. */
export function ChatTranscript(props: ChatTranscriptProps) {
  return (
    <div className="relative flex-1 overflow-hidden">
      {/* initial="instant": the reader must LAND at the newest message, not
          watch the page scroll from the top to it — with SSR-rendered
          history the smooth initial animation reads as a jump to the top
          and back down once hydration finishes.
          resize="instant": markdown/reasoning bodies are client-loaded
          through ChatMarkdownProvider before the transcript mounts, so on a
          hard reload growth should not come from empty shells filling in.
          Instant still covers streaming growth and older-page prepends. */}
      <Conversation className="h-full" initial="instant" resize="instant">
        {/* TODO(#187): a reader who walks a several-thousand-message chat
            to the top accumulates the whole transcript in the DOM. If that
            ever measures heavy, [content-visibility:auto] on message rows
            (or the virtualization #187 originally named) is the next step
            — measure before reaching for either. */}
        <ConversationContent className="mx-auto w-full max-w-3xl space-y-4 px-5 py-12">
          <ChatTranscriptBody {...props} />
        </ConversationContent>
        <ConversationScrollButton className="shadow-sm" />
      </Conversation>
    </div>
  );
}
