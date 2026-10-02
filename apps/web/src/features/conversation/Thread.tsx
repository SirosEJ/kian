import type { ReactNode } from 'react';
import { AssistantMessage } from '../../components/index.js';
import { ResultTable, type ResultTableData } from './ResultTable.js';

export type ChatMessage<T = unknown> = { id: string; role: 'user' | 'assistant'; content: string; tasks?: T[]; tables?: ResultTableData[] };

/** Kian is working on the answer. */
export function Thinking() {
  return <section className="assistant assistant-thinking" role="status" aria-label="Kian is thinking"><p className="assistant-name">Kian</p><span className="dots" aria-hidden="true"><i /><i /><i /></span></section>;
}

/** The conversation, oldest first: what the user said, Kian's replies, and each prepared task under the reply that produced it. */
export function Thread<T extends { id: string }>({ messages, renderTask, thinking }: { messages: ChatMessage<T>[]; renderTask?: (task: T, message: ChatMessage<T>) => ReactNode; thinking?: boolean }) {
  if (messages.length === 0 && !thinking) return null;
  return <div className="thread" role="log" aria-label="Conversation with Kian">
    {messages.map(message => message.role === 'assistant'
      ? <div key={message.id} className="thread-turn"><AssistantMessage>{message.content}</AssistantMessage>{message.tables?.map((table, i) => <ResultTable key={i} table={table} />)}{renderTask && message.tasks?.map(task => <div key={task.id} className="thread-task">{renderTask(task, message)}</div>)}</div>
      : <section key={message.id} className="user-message" aria-label="Your message"><p className="user-text">{message.content}</p></section>)}
    {thinking && <Thinking />}
  </div>;
}
