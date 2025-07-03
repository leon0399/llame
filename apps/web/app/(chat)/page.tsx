'use client';

import { useChat } from '@ai-sdk/react';
import { LoaderCircleIcon } from 'lucide-react';

export default function Page() {
  const { messages, input, handleInputChange, handleSubmit, status, stop } =
    useChat({
      api: '/api/v1/chat'
    });

  return (
    <>
      {messages.map(message => (
        <div key={message.id}>
          {message.role === 'user' ? 'User: ' : 'AI: '}
          {message.content}
        </div>
      ))}

      {(status === 'submitted' || status === 'streaming') && (
        <div>
          {status === 'submitted' && <LoaderCircleIcon />}
          <button type="button" onClick={() => stop()}>
            Stop
          </button>
        </div>
      )}

      <form onSubmit={handleSubmit}>
        <input
          name="prompt"
          value={input}
          onChange={handleInputChange}
          disabled={status !== 'ready'}
        />
        <button type="submit">Submit</button>
      </form>
    </>
  );
}