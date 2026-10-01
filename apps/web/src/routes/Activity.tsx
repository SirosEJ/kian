import { useEffect,useState } from 'react';
import { apiRequest } from '../api.js';
import { Alert, Button } from '../components/index.js';
export function Activity() {
  const [events,setEvents]=useState<{id:string;event:string;created_at:string;details:{externalId?:string;link?:string;error?:string}}[]>([]),[error,setError]=useState('');
  function reload() {void apiRequest('/activity').then(items=>{setEvents(items);setError('');}).catch(()=>setError('Could not load activity.'));}
  useEffect(reload,[]);
  return <section><div className="section-header"><h2>Activity</h2><Button variant="ghost" onClick={reload}>Refresh activity</Button></div>{error && <Alert tone="error">{error}</Alert>}{events.length===0 && !error && <p>No activity yet. Approved actions and their results will appear here.</p>}<ul className="list">{events.map(e=><li key={e.id}>{new Date(e.created_at).toLocaleString()}: {e.event.replace('task.','').replaceAll('.',' ')} {e.details.externalId && <span>{e.details.externalId}</span>}{e.details.link && /^https:\/\//.test(e.details.link) && <a href={e.details.link} target="_blank" rel="noreferrer">Open result</a>}{e.details.error && <Alert tone="error">{e.details.error}</Alert>}</li>)}</ul></section>;
}
