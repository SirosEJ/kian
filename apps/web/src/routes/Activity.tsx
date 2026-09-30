import { useEffect, useState } from 'react';
import { apiRequest } from '../api.js';
export function Activity() {
  const [events, setEvents] = useState<{id:string;event:string;created_at:string;task_id:string}[]>([]);
  function reload() {void apiRequest('/activity').then(setEvents).catch(()=>{});}
  useEffect(reload,[]);
  return <section><h2>Activity</h2><button onClick={reload}>Refresh activity</button><ul>{events.map(e=><li key={e.id}>{new Date(e.created_at).toLocaleString()}: {e.event} ({e.task_id})</li>)}</ul></section>;
}
