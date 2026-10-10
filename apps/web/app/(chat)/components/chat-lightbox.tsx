"use client";

import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useState,
} from "react";
import type { UIMessage } from "ai";

import { MediaLightbox } from "@workspace/ui/components/custom/media-lightbox";

import {
  type MediaOccurrence,
  useMediaOccurrenceSlides,
} from "@/lib/services/media/lightbox";

import { chatImages } from "./chat-images";

/** Opens the chat lightbox on the image with this `chatImageKey`. */
type OpenChatImage = (key: string) => void;

const ChatLightboxContext = createContext<OpenChatImage | null>(null);

/** The transcript's image opener, or `null` outside a `ChatLightbox` (a row
 *  rendered on its own), where thumbnails stay read-only. */
export function useOpenChatImage(): OpenChatImage | null {
  return useContext(ChatLightboxContext);
}

/** One open of the lightbox: the activated image and the transcript's images
 *  as they stood then, so a streaming answer cannot shift the slides. */
type LightboxSession = {
  openKey: string;
  images: ReadonlyArray<MediaOccurrence>;
};

const NO_IMAGES: ReadonlyArray<MediaOccurrence> = [];

/**
 * The transcript's lightbox: activating any image thumbnail inside it (an
 * attachment, a `read` image result, a prompt-import image) opens one
 * lightbox over every image of the chat in transcript order. Each image's
 * descriptor loads on the first open; the lightbox shows once they settle.
 * An image whose descriptor fails to load (an unknown id) is no slide, so
 * activating it opens nothing and ends the session, so a later refetch
 * cannot open the lightbox without a click.
 */
export function ChatLightbox({
  messages,
  children,
}: {
  messages: ReadonlyArray<UIMessage>;
  children: ReactNode;
}) {
  const [session, setSession] = useState<LightboxSession | null>(null);
  const open = useCallback(
    (key: string) => setSession({ openKey: key, images: chatImages(messages) }),
    [messages],
  );
  const { slides, keys, pending } = useMediaOccurrenceSlides(
    session?.images ?? NO_IMAGES,
    session !== null,
  );
  const openIndex = session === null ? -1 : keys.indexOf(session.openKey);
  if (session !== null && !pending && openIndex === -1) setSession(null);

  return (
    <ChatLightboxContext.Provider value={open}>
      {children}
      <MediaLightbox
        slides={slides}
        index={pending || openIndex === -1 ? null : openIndex}
        onClose={() => setSession(null)}
      />
    </ChatLightboxContext.Provider>
  );
}
