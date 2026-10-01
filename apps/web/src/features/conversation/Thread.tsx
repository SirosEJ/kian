import { AssistantMessage } from '../../components/index.js';

export type ChatMessage = { id: string; role: 'user' | 'assistant'; content: string };

/** The conversation so far: what the user said and Kian's replies, oldest first, so the newest sits next to the prompt. */
export function Thread({ messages }: { messages: ChatMessage[] }) {
  if (messages.length === 0) return null;
  return <div className="thread" role="log" aria-label="Conversation with Kian">
    {messages.map(message => message.role === 'assistant'
      ? <AssistantMessage key={message.id}>{message.content}</AssistantMessage>
      : <section key={message.id} className="user-message" aria-label="Your message"><p className="user-text">{message.content}</p></section>)}
  </div>;
}
