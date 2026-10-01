import type { ReactNode } from 'react';

/** Kian's own words to the user, set apart from system messages so it reads like a reply in a conversation. */
export function AssistantMessage({ children }: { children: ReactNode }) {
  return <section className="assistant" aria-label="Kian's reply"><p className="assistant-name">Kian</p><p className="assistant-text">{children}</p></section>;
}
