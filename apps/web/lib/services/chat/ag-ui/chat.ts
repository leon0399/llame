import type { AGUIEvent } from "@ag-ui/core";
import type { ChatStatus, FileUIPart, UIMessage } from "ai";

import type { FollowUpRunRequest } from "../transport";
import { ReplyReducer, type Reply } from "./reply";

/**
 * The live log of one Chat and the requests that extend it: the client half of
 * the AG-UI stream. The server owns every Run, so this only sends a turn or a
 * follow-up, attaches to the Run that is executing, and folds its events into
 * the reply.
 */

export type ChatRequest = {
  chatId: string;
  messages: Array<UIMessage>;
  /** `regenerate-message` is a follow-up Run; `submit-message` a chat send. */
  trigger: "submit-message" | "regenerate-message";
  /** The follow-up a `regenerate-message` request names. */
  body: FollowUpRunRequest | undefined;
};

export type ChatTransport = {
  sendMessages(
    request: ChatRequest,
    signal: AbortSignal,
  ): Promise<AsyncIterable<AGUIEvent>>;
  /** The stream of the Chat's executing Run, or null when it has none. */
  reconnectToStream(
    chatId: string,
    signal: AbortSignal,
  ): Promise<AsyncIterable<AGUIEvent> | null>;
};

/** How one request ended, reported once per request that opened a stream. */
export type ChatFinish = {
  message: UIMessage;
  messages: Array<UIMessage>;
  /** The owner stopped the request. */
  isAbort: boolean;
  /** The connection broke; the Run did not. */
  isDisconnect: boolean;
  isError: boolean;
  /** Set only when the stream reached a successful `RUN_FINISHED`. */
  finishReason: "stop" | undefined;
};

export type ChatSnapshot = {
  messages: Array<UIMessage>;
  status: ChatStatus;
  error: Error | undefined;
};

export type ChatInit = {
  id: string;
  messages: Array<UIMessage>;
  generateId: () => string;
  transport: ChatTransport;
  onFinish: (finish: ChatFinish) => void;
  onError: (error: Error) => void;
};

export type SendMessageInput = { text?: string; files?: Array<FileUIPart> };

export class AgUiChat {
  readonly id: string;
  private snapshot: ChatSnapshot;
  private readonly listeners = new Set<() => void>();
  private active: AbortController | null = null;

  constructor(private readonly init: ChatInit) {
    this.id = init.id;

    this.snapshot = {
      messages: init.messages,
      status: "ready",
      error: undefined,
    };
  }

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);

    return () => this.listeners.delete(listener);
  };

  readonly getSnapshot = (): ChatSnapshot => this.snapshot;

  readonly setMessages = (messages: Array<UIMessage>): void => {
    this.set({ messages });
  };

  readonly clearError = (): void => {
    if (this.snapshot.status === "error") {
      this.set({ status: "ready", error: undefined });
    }
  };

  readonly stop = (): void => {
    this.active?.abort();
  };

  /** Appends the owner's message and streams the Run that answers it. */
  readonly sendMessage = async (input: SendMessageInput): Promise<void> => {
    this.assertIdle();
    const { text, files = [] } = input;

    this.set({
      messages: [
        ...this.snapshot.messages,
        {
          id: this.init.generateId(),
          role: "user",
          parts: [
            ...files,
            ...(text === undefined ? [] : [{ type: "text" as const, text }]),
          ],
        },
      ],
    });

    await this.stream((signal) =>
      this.init.transport.sendMessages(
        this.chatRequest("submit-message", undefined),
        signal,
      ),
    );
  };

  /**
   * Streams a follow-up Run of the latest turn. The turn's reply leaves the
   * log first: the follow-up replaces it.
   */
  readonly regenerate = async (options: {
    body: FollowUpRunRequest;
  }): Promise<void> => {
    this.assertIdle();
    const { messages } = this.snapshot;

    if (messages.at(-1)?.role === "assistant") {
      this.set({ messages: messages.slice(0, -1) });
    }

    await this.stream((signal) =>
      this.init.transport.sendMessages(
        this.chatRequest("regenerate-message", options.body),
        signal,
      ),
    );
  };

  /**
   * Attaches to the Chat's executing Run, if it has one. A request already in
   * flight owns the log, so a second attach is not started, and an attach that
   * a send overtakes while it is still connecting yields to that send. A Chat
   * with no executing Run changes nothing and reports no finish; neither does
   * an attach that fails before its stream opens, which reports the error
   * alone.
   */
  readonly resumeStream = async (): Promise<void> => {
    if (this.active !== null) return;
    const abort = new AbortController();
    this.active = abort;
    let events: AsyncIterable<AGUIEvent> | null = null;
    let failure: Error | null = null;

    try {
      events = await this.init.transport.reconnectToStream(
        this.id,
        abort.signal,
      );
    } catch (error) {
      failure = error instanceof Error ? error : new Error(String(error));
    }

    if (this.active !== abort) {
      // A send started while the attach was connecting, and owns the log now.
      // Aborting closes whatever response the attach was given.
      abort.abort();

      return;
    }

    if (events === null) {
      this.active = null;

      if (failure !== null && !abort.signal.aborted) this.fail(failure);

      return;
    }

    const attached = events;

    await this.stream(() => Promise.resolve(attached), abort);
  };

  private chatRequest(
    trigger: ChatRequest["trigger"],
    body: FollowUpRunRequest | undefined,
  ): ChatRequest {
    return { chatId: this.id, messages: this.snapshot.messages, trigger, body };
  }

  private set(change: Partial<ChatSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...change };

    for (const listener of this.listeners) listener();
  }

  private fail(error: Error): void {
    this.init.onError(error);
    this.set({ status: "error", error });
  }

  private assertIdle(): void {
    if (
      this.snapshot.status === "submitted" ||
      this.snapshot.status === "streaming"
    ) {
      throw new Error("A chat request is already in progress.");
    }
  }

  /** Reads one opened stream to its end and reports how it ended. */
  private async stream(
    open: (signal: AbortSignal) => Promise<AsyncIterable<AGUIEvent>>,
    abort = new AbortController(),
  ): Promise<void> {
    const reducer = new ReplyReducer();
    const finish = { isAbort: false, isDisconnect: false, isError: false };

    if (this.active !== abort) this.active?.abort();
    this.active = abort;
    this.set({ status: "submitted", error: undefined });

    try {
      await this.read(await open(abort.signal), abort.signal, reducer);
      this.set({ status: "ready" });
    } catch (error) {
      if (
        abort.signal.aborted ||
        (error instanceof Error && error.name === "AbortError")
      ) {
        finish.isAbort = true;
        this.set({ status: "ready" });
      } else {
        this.fail(error instanceof Error ? error : new Error(String(error)));
        finish.isError = true;

        // A dropped fetch is a TypeError naming the fetch or the network.
        finish.isDisconnect =
          error instanceof TypeError && /fetch|network/i.test(error.message);
      }
    } finally {
      if (this.active === abort) this.active = null;
      const reply = reducer.reply();

      this.init.onFinish({
        ...finish,
        message: this.replyMessage(reply),
        messages: this.snapshot.messages,
        isAbort: finish.isAbort || reply.cancelled,
        finishReason: reply.finished && !reply.cancelled ? "stop" : undefined,
      });
    }
  }

  /**
   * Folds `events` into the log until they end or `signal` aborts. A source
   * that ignores the signal — a response body that outlives its request —
   * still stops being read, so a stop always ends the request.
   */
  private async read(
    events: AsyncIterable<AGUIEvent>,
    signal: AbortSignal,
    reducer: ReplyReducer,
  ): Promise<void> {
    const iterator = events[Symbol.asyncIterator]();
    let stop = () => signal.throwIfAborted();

    const aborted = new Promise<never>((_resolve, reject) => {
      stop = () => reject(new DOMException("Aborted", "AbortError"));

      if (signal.aborted) stop();
      else signal.addEventListener("abort", stop, { once: true });
    });

    aborted.catch(() => {});

    try {
      for (;;) {
        const next = await Promise.race([iterator.next(), aborted]);

        if (next.done === true) {
          throw new TypeError("Network stream ended before the Run finished.");
        }

        if (reducer.apply(next.value)) this.write(reducer.reply());

        if (reducer.reply().finished) return;
      }
    } finally {
      signal.removeEventListener("abort", stop);
      // Do not await an iterator whose pending read may never settle.
      void iterator.return?.().catch(() => {});
    }
  }

  /** Puts the reply in the log, or fails the request on the Run's failure. */
  private write(reply: Reply): void {
    if (reply.errorText !== null) throw new Error(reply.errorText);

    if (reply.runId === null) return;
    const message = this.replyMessage(reply);
    const { messages } = this.snapshot;
    const last = messages.at(-1);

    // A resumed stream replays its segment from the start, so a reply the log
    // already holds for this Run is rebuilt in place rather than appended to.
    const replaces = last?.role === "assistant" && last.id === message.id;

    // `RUN_STARTED` arrives at acceptance, while the Run may still be queued:
    // the reply takes its place in the log, and the chat is streaming only
    // once the Run has produced something.
    const produced = reply.parts.length > 0 || reply.metadata !== undefined;

    this.set({
      status: produced ? "streaming" : this.snapshot.status,
      messages: replaces
        ? [...messages.slice(0, -1), message]
        : [...messages, message],
    });
  }

  private replyMessage(reply: Reply): UIMessage {
    return {
      id: reply.runId ?? this.init.generateId(),
      role: "assistant",
      parts: reply.parts,
      ...(reply.metadata !== undefined && { metadata: reply.metadata }),
    };
  }
}
