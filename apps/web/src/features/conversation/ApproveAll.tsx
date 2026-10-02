import { useState } from 'react';
import { apiRequest } from '../../api.js';
import { Alert, Button } from '../../components/index.js';
import { approveBatch, batchSummary, describeBatch, eligibleForBatch, type BatchTask } from './batch.js';

/**
 * "Approve all N" for the cards of one reply. It never approves anything in secret: it lists what is in the batch and asks
 * once, then approves the cards one by one exactly as their own Approve buttons would.
 */
export function ApproveAll<T extends BatchTask>({ tasks, onDecided }: { tasks: T[]; onDecided: (task: T, update: { version: number; state: string }) => void }) {
  const [step, setStep] = useState<'idle' | 'confirm' | 'running' | 'done'>('idle');
  const [message, setMessage] = useState('');
  const ready = tasks.filter(eligibleForBatch);
  if (step === 'done') return <Alert tone="info">{message}</Alert>;
  if (ready.length < 2) return null;

  async function run() {
    setStep('running');
    const outcome = await approveBatch(ready, async task => {
      const updated = await apiRequest(`/tasks/${encodeURIComponent(task.id)}/decision`, 'POST', { version: task.version || 1, decision: 'approve' });
      onDecided(task as T, { version: updated.version, state: updated.state });
      return task;
    });
    setMessage(batchSummary(ready.length, outcome));
    setStep('done');
  }

  if (step === 'confirm' || step === 'running') return <div className="batch" role="group" aria-label="Approve all">
    <p>Approve these {ready.length} actions? <strong>{describeBatch(ready)}</strong>. Each one is approved separately and shown in Activity.</p>
    <div className="actions"><Button disabled={step === 'running'} onClick={() => void run()}>{step === 'running' ? 'Approving…' : `Yes, approve ${ready.length}`}</Button><Button variant="ghost" disabled={step === 'running'} onClick={() => setStep('idle')}>Cancel</Button></div>
  </div>;
  return <div className="batch"><Button variant="secondary" onClick={() => setStep('confirm')}>Approve all {ready.length}</Button></div>;
}
