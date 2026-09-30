import { useEffect, useState } from 'react';
import { apiRequest } from '../api.js';

export type ReviewTask = { id:string; action:string; version?:number; state:string; destination:string|null; connectionId?:string|null; parameters?:Record<string,unknown>; uncertainties:string[] };
export function TaskReview({ task, onChange }: { task:ReviewTask; onChange:(task:ReviewTask)=>void }) {
  const [trust, setTrust] = useState(false);
  const [editing, setEditing] = useState(false);
  const [destination, setDestination] = useState(task.destination || '');
  const [connectionId,setConnectionId]=useState(task.connectionId || '');
  const [connections,setConnections]=useState<{id:string;provider:string;display_name:string;settings:{destination?:string}}[]>([]);
  useEffect(()=>{ void apiRequest('/connections').then(setConnections).catch(()=>{}); },[]);
  const [details, setDetails] = useState(JSON.stringify(task.parameters || {}, null, 2));
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function decide(decision:'approve'|'reject') {
    setBusy(true); setError('');
    try {
      if (trust && (!task.connectionId || !task.destination)) throw new Error('Select a connection and destination first');
      const rule = trust && decision === 'approve' && task.connectionId && task.destination ? { connectionId:task.connectionId, action:task.action, destinations:[task.destination] } : undefined;
      const updated = await apiRequest(`/tasks/${encodeURIComponent(task.id)}/decision`, 'POST', { version:task.version || 1, decision, trust:rule });
      onChange({ ...task, version:updated.version, state:updated.state });
    } catch { setError('Decision could not be saved. Refresh and review this task again.'); }
    finally { setBusy(false); }
  }
  async function save() {
    setBusy(true); setError('');
    try {
      const fields = JSON.parse(details);
      const updated = await apiRequest(`/tasks/${encodeURIComponent(task.id)}`, 'PATCH', { version:task.version || 1, proposal:{ connectionId:connectionId || null, destination, fields, uncertainties:[] } });
      onChange({ ...task, version:updated.version, connectionId:connectionId || null, destination, parameters:fields, uncertainties:[], state:'proposed' });
      setEditing(false); setTrust(false);
    } catch { setError('Could not save changes. Check the details and try again.'); }
    finally { setBusy(false); }
  }
  return <article><h4>{task.action}</h4>{editing ? <><label>Connection<select value={connectionId} onChange={e=>{setConnectionId(e.target.value);const selected=connections.find(c=>c.id===e.target.value);if(selected?.settings.destination)setDestination(selected.settings.destination);}}><option value="">Choose connection</option>{connections.filter(c=>task.action.startsWith('calendar.') ? c.provider==='google_calendar' : task.action.startsWith('jira.') ? c.provider==='jira' : c.provider==='ionos').map(c=><option key={c.id} value={c.id}>{c.display_name}</option>)}</select></label><label>Destination<input value={destination} onChange={e=>setDestination(e.target.value)} /></label><label>Task details (JSON)<textarea value={details} onChange={e=>setDetails(e.target.value)} /></label><button disabled={busy} onClick={()=>void save()}>Save changes</button></> : <><p>{task.destination || 'Choose a destination'}</p><pre>{JSON.stringify(task.parameters || {}, null, 2)}</pre>{task.uncertainties.map(u=><p key={u} role="alert">{u}</p>)}</>}
    <p>Status: {task.state}</p>{task.state === 'proposed' && !editing && <><button onClick={()=>setEditing(true)}>Edit</button><button disabled={busy || task.uncertainties.length > 0} onClick={()=>void decide('approve')}>Approve</button><button disabled={busy} onClick={()=>void decide('reject')}>Reject</button><label><input type="checkbox" disabled={!task.connectionId || !task.destination} checked={trust} onChange={e=>setTrust(e.target.checked)} /> Trust and automate this task in future for this connection and destination</label></>}{error && <p role="alert">{error}</p>}
  </article>;
}
