import { useEffect, useState } from 'react';
import { apiRequest } from '../api.js';
import { Alert, Button, StatusBadge } from '../components/index.js';
import { actionNames, trustPrompt, trustUnavailable } from '../features/trust/wording.js';

export type ReviewTask = { id:string; action:string; version?:number; state:string; destination:string|null; connectionId?:string|null; parameters?:Record<string,unknown>; uncertainties:string[] };
const labels:Record<string,string>={to:'Recipients',subject:'Subject',body:'Message',summary:'Title',description:'Description',start:'Start (date and time with offset)',end:'End (date and time with offset)',timeZone:'Time zone',eventId:'Event ID',issueTypeId:'Issue type ID',issueKey:'Issue key',fields:'Additional Jira fields',_jiraSiteUrl:'Jira site'};
function printable(value:unknown):string {return Array.isArray(value) ? value.join(', ') : typeof value==='object' && value!==null ? JSON.stringify(value,null,2):String(value ?? '');}
export function TaskReview({ task, onChange }: { task:ReviewTask; onChange:(task:ReviewTask)=>void }) {
  const [trust,setTrust]=useState(false),[editing,setEditing]=useState(false),[destination,setDestination]=useState(task.destination || ''),[connectionId,setConnectionId]=useState(task.connectionId || '');
  const [connections,setConnections]=useState<{id:string;provider:string;display_name:string;settings:{destination?:string}}[]>([]);
  useEffect(()=>{void apiRequest('/connections').then(setConnections).catch(()=>{});},[]);
  const [fields,setFields]=useState<Record<string,unknown>>(task.parameters || {}),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  const fieldKeys=Array.from(new Set([...(task.action==='email.send' ? ['to','subject','body']: task.action.startsWith('calendar.') ? ['summary','start','end','timeZone',...(task.action==='calendar.update' ? ['eventId']:[])]:['summary','description',...(task.action==='jira.update' ? ['issueKey']:[])]),...Object.keys(fields).filter(k=>!k.startsWith('_jira'))]));
  async function decide(decision:'approve'|'reject') {
    setBusy(true);setError('');
    try {
      const rule=trust && decision==='approve' && task.connectionId && task.destination ? {connectionId:task.connectionId,action:task.action,destinations:[task.destination]}:undefined;
      const updated=await apiRequest(`/tasks/${encodeURIComponent(task.id)}/decision`,'POST',{version:task.version || 1,decision,trust:rule});
      onChange({...task,version:updated.version,state:updated.state});
    } catch {setError('Decision could not be saved. Refresh and review this task again.');} finally {setBusy(false);}
  }
  async function save() {
    setBusy(true);setError('');
    try {
      const updated=await apiRequest(`/tasks/${encodeURIComponent(task.id)}`,'PATCH',{version:task.version || 1,proposal:{connectionId:connectionId || null,destination,fields,uncertainties:[]}});
      onChange({...task,version:updated.version,connectionId:connectionId || null,destination,parameters:updated.parameters.fields,uncertainties:[],state:'proposed'});
      setEditing(false);setTrust(false);
    } catch {setError('Could not save changes. Check the details and try again.');} finally {setBusy(false);}
  }
  function changeField(key:string,value:string) {
    setFields(current=>({...current,[key]:key==='to' ? value.split(',').map(v=>v.trim()).filter(Boolean):value}));
    if(key==='to')setDestination(value.split(',').map(v=>v.trim()).filter(Boolean).join(', '));
  }
  return <article><header className="task-header"><h4>{actionNames[task.action] || task.action}</h4><StatusBadge state={task.state} /></header>{editing ? <>
    {task.action.startsWith('jira.') && <p>Jira site: {String(fields._jiraSiteUrl || 'Choose a site in Settings')}</p>}<label>Connection<select value={connectionId} onChange={e=>{setConnectionId(e.target.value);const c=connections.find(c=>c.id===e.target.value);if(c?.settings.destination)setDestination(c.settings.destination);}}><option value="">Choose connection</option>{connections.filter(c=>task.action.startsWith('calendar.') ? c.provider==='google_calendar':task.action.startsWith('jira.') ? c.provider==='jira':c.provider==='ionos').map(c=><option key={c.id} value={c.id}>{c.display_name}</option>)}</select></label>
    {task.action!=='email.send' && <label>{task.action.startsWith('jira.') ? 'Project key':'Calendar'}<input value={destination} onChange={e=>setDestination(e.target.value)}/></label>}
    {fieldKeys.map(key=><label key={key}>{labels[key] || key}{key==='fields' ? <textarea defaultValue={printable(fields[key])} onBlur={e=>{try {const value=JSON.parse(e.target.value);setFields(current=>({...current,fields:value}));setError('');} catch {setError('Additional Jira fields must contain valid JSON.');}}}/> : ['body','description'].includes(key) ? <textarea value={printable(fields[key])} onChange={e=>changeField(key,e.target.value)}/> : <input value={printable(fields[key])} onChange={e=>changeField(key,e.target.value)}/>}</label>)}
    <p>Review every detail before saving. Saving confirms that the questions below have been resolved.</p>{task.uncertainties.map(u=><p key={u}>{u}</p>)}<div className="actions"><Button disabled={busy || !!error} onClick={()=>void save()}>Save changes</Button><Button variant="ghost" onClick={()=>setEditing(false)}>Cancel</Button></div>
    </> : <><p>{task.destination || 'Choose a destination in Edit'}</p><dl>{Object.entries(task.parameters || {}).filter(([key])=>key!=='_jiraSiteId').map(([key,value])=><div key={key}><dt>{labels[key] || key}</dt><dd>{printable(value)}</dd></div>)}</dl>{task.uncertainties.map(u=><Alert key={u} tone="warning">{u}</Alert>)}</>}
    {task.state==='proposed' && !editing && <><div className="actions"><Button variant="ghost" onClick={()=>{setFields(task.parameters || {});setConnectionId(task.connectionId || '');setDestination(task.destination || '');setError('');setEditing(true);}}>Edit</Button><Button disabled={busy || task.uncertainties.length>0 || !task.connectionId || !task.destination} onClick={()=>void decide('approve')}>Approve</Button><Button variant="secondary" disabled={busy} onClick={()=>void decide('reject')}>Reject</Button></div>{trustUnavailable(task.action) ? <p className="muted">{trustUnavailable(task.action)}</p> : <label className="checkbox"><input type="checkbox" disabled={!task.connectionId || !task.destination || task.action.endsWith('.update')} checked={trust} onChange={e=>setTrust(e.target.checked)}/>{task.destination ? trustPrompt(task.action,task.destination,connections.find(c=>c.id===task.connectionId)?.display_name) : 'Choose a destination before trusting this task.'}</label>}</>}{error && <Alert tone="error">{error}</Alert>}
  </article>;
}
