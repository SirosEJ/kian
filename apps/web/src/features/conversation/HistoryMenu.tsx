export type ConversationSummary = { id: string; createdAt: string; title: string };

/** Past conversations, newest first. Choosing one opens it in the chat. */
export function HistoryMenu({ conversations, currentId, onPick }: { conversations: ConversationSummary[]; currentId: string | null; onPick: (id: string) => void }) {
  if (conversations.length === 0) return <div className="menu history-menu" role="menu"><p className="menu-email">No earlier conversations yet.</p></div>;
  return <div className="menu history-menu" role="menu" aria-label="Earlier conversations">
    {conversations.map(c => <button key={c.id} type="button" role="menuitem" aria-current={c.id === currentId ? 'true' : undefined} onClick={() => onPick(c.id)}><span className="history-title">{c.title}</span><span className="muted history-date">{new Date(c.createdAt).toLocaleDateString()}</span></button>)}
  </div>;
}
