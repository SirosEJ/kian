import { useEffect,useState } from 'react';
import { apiRequest } from '../api.js';
import { PromptBox } from '../features/prompt/PromptBox.js';
import { TaskReview, type ReviewTask } from './TaskReview.js';

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
  const result = await apiRequest('/transcriptions', 'POST', { audioBase64: await encode(blob), mimeType: blob.type });
  return result.text;
}

export function Dashboard() {
  const [tasks, setTasks] = useState<ReviewTask[]>([]);
  const [error, setError] = useState('');
  useEffect(()=>{void apiRequest('/tasks').then(setTasks).catch(()=>{});},[]);

  function refreshTasks() {void apiRequest('/tasks').then(setTasks).catch(()=>setError('Could not refresh tasks.'));}

  async function submit(text: string) {
    const result = await apiRequest('/instructions', 'POST', { text, locale: navigator.language, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone });
    setError('');
    setTasks(current=>[...result.tasks,...current]);
  }

  return <section><h2>What would you like Kian to do?</h2>
    <PromptBox onSubmit={submit} transcribe={transcribe} />
    {error && <p role="alert">{error}</p>}
    {tasks.length === 0 && <p>Welcome to Kian. Connect Google Calendar, Jira Cloud or your mailbox in Settings below, then type or record an instruction. Kian shows every proposed action for your approval before anything happens.</p>}
    {tasks.length > 0 && <section aria-label="Proposed tasks"><h3>Your tasks</h3><button onClick={refreshTasks}>Refresh tasks</button>{tasks.map(task => <TaskReview key={task.id} task={task} onChange={changed=>setTasks(current=>current.map(t=>t.id===changed.id ? changed : t))} />)}</section>}
  </section>;
}
