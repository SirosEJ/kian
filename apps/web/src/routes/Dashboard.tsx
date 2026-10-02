import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { apiRequest } from '../api.js';
import { Alert, AssistantMessage, Button } from '../components/index.js';
import { PromptBox } from '../features/prompt/PromptBox.js';
import { TaskReview, type ReviewTask } from './TaskReview.js';
import { Link } from '../layout/Link.js';
import { describePlanResult } from '../features/prompt/planResult.js';
import { Thread, type ChatMessage } from '../features/conversation/Thread.js';
import { Welcome } from '../features/conversation/Welcome.js';
import { ApproveAll } from '../features/conversation/ApproveAll.js';
import { HistoryMenu, type ConversationSummary } from '../features/conversation/HistoryMenu.js';
import { isNearBottom, scrollDecision } from '../features/conversation/scroll.js';

async function encode(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1]);
    reader.onerror = () => reject(new Error('Could not read recording'));
    reader.readAsDataURL(blob);
  });
}

async function transcribe(blob: Blob): Promise<string> {
  if (blob.size > 10 * 1024 * 1024) throw Object.assign(new Error('Recording exceeds 10 MB'), { tooLarge: true });
  const result = await apiRequest('/transcriptions', 'POST', { audioBase64: await encode(blob), mimeType: blob.type.split(';')[0] });
  return result.text;
}

type Msg = ChatMessage<ReviewTask>;

/** On phones the on-screen keyboard shrinks the visual viewport but not the layout one; follow it so the prompt stays visible. */
function useVisibleHeight() {
  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;
    const apply = () => { document.documentElement.style.setProperty('--app-height', `${viewport.height}px`); window.scrollTo(0, 0); };
    apply();
    viewport.addEventListener('resize', apply);
    return () => { viewport.removeEventListener('resize', apply); document.documentElement.style.removeProperty('--app-height'); };
  }, []);
}

export function Dashboard() {
  const [tasks, setTasks] = useState<ReviewTask[]>([]);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [messages, setMessages] = useState<Msg[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [thinking, setThinking] = useState(false);
  const [history, setHistory] = useState<ConversationSummary[] | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const atBottom = useRef(true);
  const justSent = useRef(false);
  const [showJump, setShowJump] = useState(false);
  useVisibleHeight();

  const open = useCallback((latest: { conversationId: string | null; messages: Msg[] }) => { setConversationId(latest.conversationId); setMessages(latest.messages); justSent.current = true; }, []);
  useEffect(() => {
    void apiRequest('/tasks').then(setTasks).catch(() => {});
    void apiRequest('/conversations/latest').then(open).catch(() => {});
  }, [open]);

  // Keep the newest message in view, unless the reader scrolled up to read something earlier.
  useLayoutEffect(() => {
    const box = scroller.current;
    if (!box) return;
    if (scrollDecision(atBottom.current, justSent.current) === 'follow') { box.scrollTop = box.scrollHeight; setShowJump(false); }
    else setShowJump(true);
    justSent.current = false;
  }, [messages, thinking]);

  function onScroll() {
    const box = scroller.current;
    if (!box) return;
    atBottom.current = isNearBottom(box);
    if (atBottom.current) setShowJump(false);
  }
  const jump = () => { const box = scroller.current; if (box) box.scrollTo({ top: box.scrollHeight, behavior: 'smooth' }); };

  async function submit(text: string) {
    const stamp = Date.now();
    justSent.current = true;
    setMessages(current => [...current, { id: `pending-${stamp}`, role: 'user', content: text }]);
    setThinking(true);
    setHistory(null);
    try {
      const result = await apiRequest('/instructions', 'POST', { text, conversationId: conversationId ?? undefined, locale: navigator.language, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone });
      setError('');
      setNotice(describePlanResult(result).notice);
      setConversationId(result.conversationId);
      justSent.current = true;
      // Reload the thread so every card shows its current state (an earlier proposal may now be replaced).
      try { open(await apiRequest(`/conversations/${encodeURIComponent(result.conversationId)}`)); }
      catch { setMessages(current => [...current.filter(m => m.id !== `pending-${stamp}`), { id: `u${stamp}`, role: 'user', content: text }, { id: `a${stamp}`, role: 'assistant', content: result.reply, tasks: result.tasks, tables: result.tables }]); }
      void apiRequest('/tasks').then(setTasks).catch(() => {});
    } catch (failure) {
      setMessages(current => current.filter(m => m.id !== `pending-${stamp}`));
      throw failure;
    } finally { setThinking(false); }
  }

  async function startOver() {
    try {
      const created = await apiRequest('/conversations', 'POST');
      setConversationId(created.conversationId);setMessages([]);setNotice('');setError('');setHistory(null);
    } catch {setError('Could not start a new conversation. Try again.');}
  }

  async function toggleHistory() {
    if (history) { setHistory(null); return; }
    try { setHistory(await apiRequest('/conversations')); } catch { setError('Could not load earlier conversations.'); }
  }
  async function openConversation(id: string) {
    try { open(await apiRequest(`/conversations/${encodeURIComponent(id)}`)); setHistory(null); setNotice(''); setError(''); }
    catch { setError('Could not open that conversation.'); }
  }

  const onChange = (changed: ReviewTask) => {
    setMessages(current => current.map(m => m.tasks ? { ...m, tasks: m.tasks.map(t => t.id === changed.id ? changed : t) } : m));
    setTasks(current => current.map(t => t.id === changed.id ? changed : t));
  };
  // Proposals from before conversations existed have no message to sit under; keep them reachable.
  const inChat = new Set(messages.flatMap(m => (m.tasks ?? []).map(t => t.id)));
  const waiting = tasks.filter(t => t.state === 'proposed' && !inChat.has(t.id) && messages.length === 0);
  const empty = messages.length === 0 && !thinking;

  return <section className="chat" aria-label="Chat with Kian">
    <div className="chat-header"><div className="chat-column chat-actions">
      <div className="history"><Button variant="ghost" aria-haspopup="menu" aria-expanded={history !== null} onClick={() => void toggleHistory()}>History</Button>{history && <HistoryMenu conversations={history} currentId={conversationId} onPick={id => void openConversation(id)} />}</div>
      <Button variant="ghost" disabled={messages.length === 0 || thinking} onClick={() => void startOver()}>New conversation</Button>
    </div></div>
    <div className="chat-body">
      <div className="chat-scroll" ref={scroller} onScroll={onScroll}><div className="chat-column">
        {empty && <Welcome onPick={text => void submit(text).catch(() => setError('Could not reach Kian. Try again.'))} disabled={thinking} />}
        {empty && waiting.length > 0 && <section aria-label="Waiting for you"><h3>Waiting for your decision</h3>{waiting.map(task => <TaskReview key={task.id} task={task} onChange={onChange} />)}</section>}
        <Thread messages={messages} thinking={thinking} renderTask={task => <TaskReview task={task} onChange={onChange} />} renderTurnFooter={message => message.tasks && message.tasks.length > 1 ? <ApproveAll tasks={message.tasks} onDecided={(task, update) => onChange({ ...task, ...update })} /> : null} />
      </div></div>
      {showJump && <Button className="jump" variant="secondary" onClick={jump}>Jump to latest</Button>}
    </div>
    <div className="chat-composer"><div className="chat-column">
      {error && <Alert tone="error">{error}</Alert>}
      {notice && <Alert tone="info">{notice}</Alert>}
      <PromptBox onSubmit={submit} transcribe={transcribe} />
    </div></div>
  </section>;
}
