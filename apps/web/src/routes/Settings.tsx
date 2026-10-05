import { useEffect, useState } from 'react';
import { apiRequest } from '../api.js';
import { JiraSettings } from './JiraSettings.js';
import { MailSettings } from './MailSettings.js';
import { MailboxStatus } from './MailboxStatus.js';
import { MemorySettings } from './MemorySettings.js';
import { TeamsSettings } from './TeamsSettings.js';
import { Alert, Button, Card } from '../components/index.js';
import { ruleSentence } from '../features/trust/wording.js';
export function Settings() {
  const [rules, setRules] = useState<{id:string;action:string;connection_id:string;constraints:{destinations:string[]};revoked_at:string|null;created_at?:string;connection_name?:string|null}[]>([]);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [connections,setConnections]=useState<{id:string;provider:string;display_name:string;settings:{destination?:string;siteId?:string;siteUrl?:string;issueTypeId?:string;mailbox?:string;accountName?:string;account?:string;host?:string}}[]>([]);
  const [destinations,setDestinations]=useState<Record<string,{id:string;name:string;canWrite:boolean}[]>>({});
  const [busy,setBusy]=useState(false);
  async function reload() { setRules(await apiRequest('/trust-rules')); setConnections(await apiRequest('/connections')); }
  useEffect(()=>{
    const params=new URLSearchParams(window.location.search),code=params.get('code'),state=params.get('state');
    // Microsoft sends the user back with an error (no code) when sign-in is refused or an administrator has to approve Kian first.
    const refused=params.get('error'),detail=params.get('error_description') || '';
    if(refused && state?.startsWith('teams_')) {
      window.history.replaceState({},'',window.location.pathname);
      setError(/AADSTS(65001|90094|90008|650057|700016)|admin/i.test(detail) ? 'Microsoft needs an administrator of your organisation to approve Kian before you can connect. Ask your Microsoft 365 admin to approve it, then try again.' : 'Microsoft sign-in was cancelled or refused. Please try again.');
      void reload().catch(()=>undefined);
    } else if(code && state) {
      window.history.replaceState({},'',window.location.pathname);
      setBusy(true);
      const provider=state.startsWith('jira_') ? 'jira' : state.startsWith('teams_') ? 'teams' : 'google';
      void apiRequest(`/connections/${provider}/complete`,'POST',{code,state}).then(reload).then(()=>setNotice('Account connected.')).catch((e:unknown)=>setError(provider==='teams' && e instanceof Error && /administrator/.test(e.message) ? e.message : 'Account connection failed. Please reconnect.')).finally(()=>setBusy(false));
    } else void reload().catch(()=>setError('Could not load settings.'));
  },[]);
  async function connectGoogle() { setBusy(true); setError(''); try { const result=await apiRequest('/connections/google/start','POST'); window.location.assign(result.url); } catch { setError('Google Calendar is not configured yet.'); setBusy(false); } }
  async function connectJira() { setBusy(true); setError(''); try { const result=await apiRequest('/connections/jira/start','POST'); window.location.assign(result.url); } catch { setError('Jira Cloud is not configured yet.'); setBusy(false); } }
  async function connectTeams() { setBusy(true); setError(''); try { const result=await apiRequest('/connections/teams/start','POST'); window.location.assign(result.url); } catch { setError('Microsoft Teams is not available yet.'); setBusy(false); } }
  async function discover(id:string) { try { const items=await apiRequest(`/connections/${encodeURIComponent(id)}/destinations`); setDestinations(current=>({...current,[id]:items})); } catch { setError('Could not read calendars. Reconnect if access has expired.'); } }
  async function select(id:string,destination:string) { try { await apiRequest(`/connections/${encodeURIComponent(id)}/destination`,'PUT',{destination}); await reload(); } catch { setError('Could not select that calendar.'); } }
  async function disconnect(id:string) { try { await apiRequest(`/connections/${encodeURIComponent(id)}`,'DELETE'); await reload(); } catch { setError('Could not disconnect.'); } }
  async function revoke(id:string) { try { await apiRequest(`/trust-rules/${encodeURIComponent(id)}`, 'DELETE'); await reload(); } catch { setError('Could not revoke trust.'); } }
  return <section><h2>Settings</h2>{notice && <Alert tone="success">{notice}</Alert>}{error && <Alert tone="error">{error}</Alert>}<Card><h3>Connections</h3><div className="actions"><Button disabled={busy} onClick={()=>void connectGoogle()}>Connect Google Calendar</Button><Button disabled={busy} onClick={()=>void connectJira()}>Connect Jira Cloud</Button><Button disabled={busy} onClick={()=>void connectTeams()}>Connect Microsoft Teams</Button></div><MailSettings onUpdated={reload}/>{connections.length===0 && <p>No services connected yet. Choose a provider above to get started.</p>}{connections.map(c=><article key={c.id}><h4>{c.display_name}</h4>{c.provider==='jira' ? <JiraSettings id={c.id} settings={c.settings} onUpdated={reload}/> : c.provider==='teams' ? <TeamsSettings id={c.id} settings={c.settings}/> : c.provider==='google_calendar' ? <><p>Selected calendar: {c.settings.destination || 'Choose a calendar'}</p><Button variant="secondary" onClick={()=>void discover(c.id)}>Choose calendar</Button>{destinations[c.id] && <select aria-label={`Calendar for ${c.display_name}`} value={c.settings.destination || ''} onChange={e=>void select(c.id,e.target.value)}><option value="">Select a calendar</option>{destinations[c.id].filter(d=>d.canWrite).map(d=><option key={d.id} value={d.id}>{d.name}</option>)}</select>}</> : <MailboxStatus id={c.id} settings={c.settings} onUpdated={reload}/>}<Button variant="ghost" onClick={()=>void disconnect(c.id)}>Disconnect</Button></article>)}</Card><Card><h3>Trusted actions</h3>{rules.length===0 && <p>No trusted actions. Kian asks for your approval each time until you choose to trust an action.</p>}<ul className="list">{rules.map(r=><li key={r.id}><strong>{ruleSentence(r)}</strong><p className="muted">{r.revoked_at ? `Revoked ${new Date(r.revoked_at).toLocaleDateString()}. Kian asks you first again.` : `Active${r.created_at ? ` since ${new Date(r.created_at).toLocaleDateString()}` : ''}. Kian does this without asking only for this exact recipient, calendar or project.`}</p>{!r.revoked_at && <Button variant="ghost" onClick={()=>void revoke(r.id)}>Revoke</Button>}</li>)}</ul></Card><MemorySettings /></section>;
}
