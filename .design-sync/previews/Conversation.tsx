// Owned preview — same reason as Message.tsx: conversation.stories.tsx imports
// MessageResponse (Streamdown → Shiki grammars + mermaid + katex), which made
// _preview/Conversation.js 19.3 MB against a 12 MB cap. This mirrors the
// stories' JSX using only what the shipped bundle contains; each message's
// content is a single plain sentence, exactly what MessageResponse rendered as
// one paragraph there.
import * as React from "react";
import { MessageSquareIcon } from "lucide-react";

import {
  Conversation,
  ConversationContent,
  ConversationEmptyState,
  ConversationScrollButton,
} from "@workspace/ui/components/ai-elements/conversation";
import {
  Message,
  MessageContent,
} from "@workspace/ui/components/ai-elements/message";

export const Basic = () => (
  <Conversation aria-label="Conversation transcript">
    <ConversationContent>
      <Message from="user">
        <MessageContent>What is the capital of France?</MessageContent>
      </Message>
      <Message from="assistant">
        <MessageContent>The capital of France is Paris.</MessageContent>
      </Message>
      <Message from="user">
        <MessageContent>And what is its population?</MessageContent>
      </Message>
      <Message from="assistant">
        <MessageContent>
          Paris has a population of roughly 2.1 million people within the city
          proper.
        </MessageContent>
      </Message>
    </ConversationContent>
    <ConversationScrollButton />
  </Conversation>
);

export const Empty = () => (
  <Conversation aria-label="Conversation transcript">
    <ConversationContent>
      <ConversationEmptyState
        description="Type a message below to begin chatting"
        icon={<MessageSquareIcon className="size-12" />}
        title="Start a conversation"
      />
    </ConversationContent>
  </Conversation>
);
