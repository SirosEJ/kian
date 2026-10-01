import { useEffect,useState } from 'react';
import { apiRequest } from '../api.js';
import { Alert, Button } from '../components/index.js';
import { activityTitle, eventLabel } from '../features/trust/wording.js';
export function Activity() {
  const [events,setEvents]=useState<{id:string;event:string;created_at:string;action?:string|null;destination?:string|null;details:{externalId?:string;link?:string;error?:string}}[]>([]),[error,setError]=useState('');
  function reload() {void apiRequest('/activity').then(items=>{setEvents(items);setError('');}).catch(()=>setError('Could not load activity.'));}
  useEffect(reload,[]);
  return <section><div className="section-header"><h2>Activity</h2><Button variant="ghost" onClick={reload}>Refresh activity</Button></div>{error && <Alert tone="error">{error}</Alert>}{events.length===0 && !error && <p>No activity yet. Approved actions and their results will appear here.</p>}<ul className="list">{events.map(e=><li key={e.id}><strong>{activityTitle(e.action,e.destination)}</strong><p className="muted">{eventLabel(e.event)} · {new Date(e.created_at).toLocaleString()}</p>{e.details.externalId && <p className="muted">Message ID: {e.details.externalId}</p>}{e.details.link && /^https:\/\//.test(e.details.link) && <a href={e.details.link} target="_blank" rel="noreferrer">Open result</a>}{e.details.error && <Alert tone="error">{e.details.error}</Alert>}</li>)}</ul></section>;
}
