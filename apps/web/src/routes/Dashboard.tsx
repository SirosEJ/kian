import { useEffect,useState, type FormEvent } from 'react';
import { apiRequest } from '../api.js';
import { Recorder } from '../features/recording/Recorder.js';
import { TaskReview, type ReviewTask } from './TaskReview.js';


async function encode(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1]);
    reader.onerror = () => reject(new Error('Could not read recording'));
    reader.readAsDataURL(blob);
  });
}

export function Dashboard() {
  const [text, setText] = useState('');
  const [tasks, setTasks] = useState<ReviewTask[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(()=>{void apiRequest('/tasks').then(setTasks).catch(()=>{});},[]);

  function refreshTasks() {void apiRequest('/tasks').then(setTasks).catch(()=>setError('Could not refresh tasks.'));}

  async function transcribe(blob: Blob) {
    if (blob.size > 10 * 1024 * 1024) { setError('Recording exceeds 10 MB. Please use a shorter recording.'); return; }
    setBusy(true); setError('');
    try { const result = await apiRequest('/transcriptions', 'POST', { audioBase64: await encode(blob), mimeType: blob.type }); setText(result.text); }
    catch { setError('Transcription failed. Please retry or type the instruction.'); }
    finally { setBusy(false); }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError('');
    try {
      const result = await apiRequest('/instructions', 'POST', { text, locale: navigator.language, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone });
      setTasks(current=>[...result.tasks,...current]);
    } catch { setError('Could not prepare tasks. Check the instruction or connection and try again.'); }
    finally { setBusy(false); }
  }

  return <section><h2>What would you like Kian to do?</h2><Recorder onRecorded={transcribe}/>
    <form onSubmit={submit}><label>Type an instruction<textarea required value={text} onChange={event => setText(event.target.value)} placeholder="Create a Jira story, book a meeting, or write an email" /></label><button disabled={busy} type="submit">Review tasks</button></form>
    {error && <p role="alert">{error}</p>}
    {tasks.length > 0 && <section aria-label="Proposed tasks"><h3>Your tasks</h3><button onClick={refreshTasks}>Refresh tasks</button>{tasks.map(task => <TaskReview key={task.id} task={task} onChange={changed=>setTasks(current=>current.map(t=>t.id===changed.id ? changed : t))} />)}</section>}
  </section>;
}
