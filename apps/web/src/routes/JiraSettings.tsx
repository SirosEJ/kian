import { useState } from 'react';
import { apiRequest } from '../api.js';
import { Alert, Button } from '../components/index.js';

type Project={projectKey:string;name:string;issueTypes:{id:string;name:string}[]};
export function JiraSettings({id,settings,onUpdated}:{id:string;settings:{siteId?:string;siteUrl?:string;destination?:string;issueTypeId?:string};onUpdated:()=>Promise<void>}) {
  const [sites,setSites]=useState<{id:string;name:string;url:string}[]>([]);
  const [projects,setProjects]=useState<Project[]>([]);
  const [projectKey,setProjectKey]=useState(settings.destination || '');
  const [issueType,setIssueType]=useState(settings.issueTypeId || '');
  const [error,setError]=useState('');
  async function loadSites() { try {setSites(await apiRequest(`/connections/jira/${id}/sites`));} catch {setError('Could not read authorized Jira sites. Reconnect if access has expired.');} }
  async function chooseSite(siteId:string) { try {await apiRequest(`/connections/jira/${id}/site`,'PUT',{siteId});setProjects([]);setProjectKey('');setIssueType('');await onUpdated();} catch {setError('Could not select that Jira site.');} }
  async function loadProjects() { try {const list=await apiRequest<Project[]>(`/connections/jira/${id}/projects`);setProjects(list);if(Array.isArray(list)&&list.length===0)setError('No Jira project was found where you can create issues. Ask the Jira site admin for access, then try again.');} catch {setError('Could not read accessible Jira projects. Check site access and permissions.');} }
  async function save() { try {await apiRequest(`/connections/jira/${id}/project`,'PUT',{projectKey,issueTypeId:issueType});await onUpdated();setError('');} catch {setError('Could not select that project and issue type.');} }
  return <div><p>Site: {settings.siteUrl || 'Choose a site'}</p><Button variant="secondary" onClick={()=>void loadSites()}>Choose Jira site</Button>{sites.length>0 && <select aria-label="Jira site" value={settings.siteId || ''} onChange={e=>void chooseSite(e.target.value)}><option value="">Select site</option>{sites.map(s=><option key={s.id} value={s.id}>{s.name} ({s.url})</option>)}</select>}<p>Project: {settings.destination || 'Choose a project'}</p><Button variant="secondary" disabled={!settings.siteId} onClick={()=>void loadProjects()}>Choose Jira project</Button>{projects.length>0 && <><label>Project<select value={projectKey} onChange={e=>{setProjectKey(e.target.value);setIssueType('');}}><option value="">Select project</option>{projects.map(p=><option key={p.projectKey} value={p.projectKey}>{p.name} ({p.projectKey})</option>)}</select></label><label>Issue type<select value={issueType} onChange={e=>setIssueType(e.target.value)}><option value="">Select issue type</option>{projects.find(p=>p.projectKey===projectKey)?.issueTypes.map(t=><option key={t.id} value={t.id}>{t.name}</option>)}</select></label><Button disabled={!projectKey || !issueType} onClick={()=>void save()}>Save Jira project</Button></>}{error && <Alert tone="error">{error}</Alert>}</div>;
}
