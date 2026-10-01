import { useEffect,useState } from 'react';
import { apiRequest } from '../api.js';
import { Alert, AssistantMessage, Button } from '../components/index.js';
import { PromptBox } from '../features/prompt/PromptBox.js';
import { TaskReview, type ReviewTask } from './TaskReview.js';
import { Link } from '../layout/Link.js';
import { describePlanResult } from '../features/prompt/planResult.js';
import { Thread, type ChatMessage } from '../features/conversation/Thread.js';

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

export function Dashboard() {
  const [tasks, setTasks] = useState<ReviewTask[]>([]);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  useEffect(()=>{
    void apiRequest('/tasks').then(setTasks).catch(()=>{});
    void apiRequest('/conversations/latest').then(latest=>{setConversationId(latest.conversationId);setMessages(latest.messages);}).catch(()=>{});
  },[]);

  function refreshTasks() {void apiRequest('/tasks').then(setTasks).catch(()=>setError('Could not refresh tasks.'));}

  async function submit(text: string) {
    const result = await apiRequest('/instructions', 'POST', { text, conversationId: conversationId ?? undefined, locale: navigator.language, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone });
    setError('');
    const shown = describePlanResult(result);
    setNotice(shown.notice);
    setConversationId(result.conversationId);
    const stamp = Date.now();
    setMessages(current=>[...current,{id:`u${stamp}`,role:'user',content:text},{id:`a${stamp}`,role:'assistant',content:shown.reply || 'I did not find anything to prepare from that.'}]);
    // A later message can replace an earlier undecided proposal, so reload the list instead of only adding to it.
    refreshTasks();
  }

  async function startOver() {
    try {
      const created = await apiRequest('/conversations', 'POST');
      setConversationId(created.conversationId);setMessages([]);setNotice('');setError('');
    } catch {setError('Could not start a new conversation. Try again.');}
  }

  const open = tasks.filter(task=>task.state!=='replaced');
  return <section><div className="section-header"><h2>What would you like Kian to do?</h2>{messages.length>0 && <Button variant="ghost" onClick={()=>void startOver()}>New conversation</Button>}</div>
    <Thread messages={messages} />
    <PromptBox onSubmit={submit} transcribe={transcribe} />
    {error && <Alert tone="error">{error}</Alert>}
    {notice && <Alert tone="info">{notice}</Alert>}
    {open.length === 0 && messages.length === 0 && <p>Welcome to Kian. Connect Google Calendar, Jira Cloud or your mailbox under <Link to="/settings">Settings</Link> (open it from your profile at the top right), then type or record what you need. Kian talks it through with you and shows every proposed action for your approval before anything happens.</p>}
    {open.length > 0 && <section aria-label="Proposed tasks"><div className="section-header"><h3>Your tasks</h3><Button variant="ghost" onClick={refreshTasks}>Refresh tasks</Button></div>{open.map(task => <TaskReview key={task.id} task={task} onChange={changed=>setTasks(current=>current.map(t=>t.id===changed.id ? changed : t))} />)}</section>}
  </section>;
}
