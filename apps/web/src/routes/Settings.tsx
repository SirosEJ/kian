import { useEffect, useState } from 'react';
import { apiRequest } from '../api.js';
import { JiraSettings } from './JiraSettings.js';
import { MailSettings } from './MailSettings.js';
export function Settings() {
  const [rules, setRules] = useState<{id:string;action:string;connection_id:string;constraints:{destinations:string[]};revoked_at:string|null}[]>([]);
  const [error, setError] = useState('');
  const [connections,setConnections]=useState<{id:string;provider:string;display_name:string;settings:{destination?:string;siteId?:string;siteUrl?:string;issueTypeId?:string}}[]>([]);
  const [destinations,setDestinations]=useState<Record<string,{id:string;name:string;canWrite:boolean}[]>>({});
  const [busy,setBusy]=useState(false);
  async function reload() { setRules(await apiRequest('/trust-rules')); setConnections(await apiRequest('/connections')); }
  useEffect(()=>{
    const params=new URLSearchParams(window.location.search),code=params.get('code'),state=params.get('state');
    if(code && state) {
      window.history.replaceState({},'',window.location.pathname);
      setBusy(true);
      const provider=state.startsWith('jira_') ? 'jira' : 'google';
      void apiRequest(`/connections/${provider}/complete`,'POST',{code,state}).then(reload).catch(()=>setError('Account connection failed. Please reconnect.')).finally(()=>setBusy(false));
    } else void reload().catch(()=>setError('Could not load settings.'));
  },[]);
  async function connectGoogle() { setBusy(true); setError(''); try { const result=await apiRequest('/connections/google/start','POST'); window.location.assign(result.url); } catch { setError('Google Calendar is not configured yet.'); setBusy(false); } }
  async function connectJira() { setBusy(true); setError(''); try { const result=await apiRequest('/connections/jira/start','POST'); window.location.assign(result.url); } catch { setError('Jira Cloud is not configured yet.'); setBusy(false); } }
  async function discover(id:string) { try { const items=await apiRequest(`/connections/${encodeURIComponent(id)}/destinations`); setDestinations(current=>({...current,[id]:items})); } catch { setError('Could not read calendars. Reconnect if access has expired.'); } }
  async function select(id:string,destination:string) { try { await apiRequest(`/connections/${encodeURIComponent(id)}/destination`,'PUT',{destination}); await reload(); } catch { setError('Could not select that calendar.'); } }
  async function disconnect(id:string) { try { await apiRequest(`/connections/${encodeURIComponent(id)}`,'DELETE'); await reload(); } catch { setError('Could not disconnect.'); } }
  async function revoke(id:string) { try { await apiRequest(`/trust-rules/${encodeURIComponent(id)}`, 'DELETE'); await reload(); } catch { setError('Could not revoke trust.'); } }
  return <section><h2>Settings</h2><h3>Connections</h3><button disabled={busy} onClick={()=>void connectGoogle()}>Connect Google Calendar</button><button disabled={busy} onClick={()=>void connectJira()}>Connect Jira Cloud</button><MailSettings onUpdated={reload}/>{connections.map(c=><article key={c.id}><h4>{c.display_name}</h4>{c.provider==='jira' ? <JiraSettings id={c.id} settings={c.settings} onUpdated={reload}/> : c.provider==='google_calendar' ? <><p>Selected calendar: {c.settings.destination || 'Choose a calendar'}</p><button onClick={()=>void discover(c.id)}>Choose calendar</button>{destinations[c.id] && <select aria-label={`Calendar for ${c.display_name}`} value={c.settings.destination || ''} onChange={e=>void select(c.id,e.target.value)}><option value="">Select a calendar</option>{destinations[c.id].filter(d=>d.canWrite).map(d=><option key={d.id} value={d.id}>{d.name}</option>)}</select>}</> : <p>Email mailbox connected</p>}<button onClick={()=>void disconnect(c.id)}>Disconnect</button></article>)}<h3>Trusted actions</h3>{error && <p role="alert">{error}</p>}<ul>{rules.map(r=><li key={r.id}>{r.action} to {r.constraints.destinations.join(', ')} {r.revoked_at ? '(revoked)' : <button onClick={()=>void revoke(r.id)}>Revoke</button>}</li>)}</ul></section>;
}
