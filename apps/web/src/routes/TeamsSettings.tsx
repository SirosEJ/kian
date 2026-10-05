import { useState } from 'react';
import { apiRequest } from '../api.js';
import { Alert, Button } from '../components/index.js';

export function TeamsSettings({ id, settings }: { id: string; settings: { accountName?: string; account?: string } }) {
  const [result, setResult] = useState('');
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  async function test() {
    setBusy(true); setResult(''); setFailed(false);
    try { const r = await apiRequest(`/connections/teams/${encodeURIComponent(id)}/test`, 'POST'); setResult(`Connected as ${r.accountName}${r.account ? ` (${r.account})` : ''}.`); }
    catch (e) { setFailed(true); setResult(e instanceof Error && e.message ? e.message : 'Microsoft could not be reached. Try again.'); }
    finally { setBusy(false); }
  }
  return <div>
    <p>Signed in as {settings.accountName || 'your Microsoft account'}{settings.account ? ` (${settings.account})` : ''}.</p>
    <p className="muted">Kian only uses Teams as you, with your own permissions. Nothing is sent without your approval.</p>
    <Button variant="secondary" disabled={busy} onClick={() => void test()}>Test connection</Button>
    {result && <Alert tone={failed ? 'error' : 'success'}>{result}</Alert>}
  </div>;
}
