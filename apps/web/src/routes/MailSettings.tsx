import { useState,type FormEvent } from 'react';
import { apiRequest } from '../api.js';
export function MailSettings({onUpdated}:{onUpdated:()=>Promise<void>}) {
  const [host,setHost]=useState('smtp.ionos.co.uk'),[user,setUser]=useState(''),[password,setPassword]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  async function submit(event:FormEvent) {event.preventDefault();setBusy(true);setError('');try {await apiRequest('/connections/ionos','POST',{host,user,password});setPassword('');await onUpdated();} catch(e) {setError((e as {status?:number}).status===422 ? (e as Error).message : 'Could not connect. Check your IONOS server and mailbox credentials.');} finally {setBusy(false);}}
  return <form onSubmit={submit}><h4>Connect IONOS email</h4><label>Mail server<select value={host} onChange={e=>setHost(e.target.value)}><option value="smtp.ionos.co.uk">IONOS UK</option><option value="smtp.ionos.com">IONOS US</option><option value="smtp.ionos.de">IONOS Germany</option></select></label><label>Email address<input type="email" required value={user} onChange={e=>setUser(e.target.value)}/></label><label>Mailbox password<input type="password" autoComplete="off" required value={password} onChange={e=>setPassword(e.target.value)}/></label><button disabled={busy}>Test and save mailbox</button>{error && <p role="alert">{error}</p>}</form>;
}
