import { useEffect,useState } from 'react';
import { apiRequest } from '../api.js';
export function Activity() {
  const [events,setEvents]=useState<{id:string;event:string;created_at:string;details:{externalId?:string;link?:string;error?:string}}[]>([]),[error,setError]=useState('');
  function reload() {void apiRequest('/activity').then(items=>{setEvents(items);setError('');}).catch(()=>setError('Could not load activity.'));}
  useEffect(reload,[]);
  return <section><h2>Activity</h2><button onClick={reload}>Refresh activity</button>{error && <p role="alert">{error}</p>}{events.length===0 && !error && <p>No activity yet. Approved actions and their results will appear here.</p>}<ul>{events.map(e=><li key={e.id}>{new Date(e.created_at).toLocaleString()}: {e.event.replace('task.','').replaceAll('.',' ')} {e.details.externalId && <span>{e.details.externalId}</span>}{e.details.link && /^https:\/\//.test(e.details.link) && <a href={e.details.link} target="_blank" rel="noreferrer">Open result</a>}{e.details.error && <p>{e.details.error}</p>}</li>)}</ul></section>;
}
