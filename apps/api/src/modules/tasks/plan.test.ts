import { describe, expect, it } from 'vitest';
import { createPlanner } from './plan.js';

const item = (action: string, destination: string | null = null) => ({ action, connectionId: null, destination, parameters: {}, uncertainties: [] });

describe('instruction planning', () => {
  it('turns a text request into a proposed task without executing it', async () => {
    let calls = 0;
    const plan = createPlanner(async () => { calls++; return [item('jira.create', 'SFT')]; });
    const tasks = await plan('alice', 'Create a Jira story', 'en-GB', 'Europe/Istanbul');
    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toMatchObject({ action: 'jira.create', state: 'proposed', destination: 'SFT' });
    expect(calls).toBe(1);
  });

  it('keeps two actions as two independently reviewable proposals', async () => {
    const plan = createPlanner(async () => [item('calendar.create'), item('email.send')]);
    const tasks = await plan('alice', 'Book it and email her', 'en-GB', 'Europe/Istanbul');
    expect(tasks).toHaveLength(2);
    expect(new Set(tasks.map(t => t.id)).size).toBe(2);
  });

  it('flags a relative Friday date for clarification', async () => {
    const plan = createPlanner(async () => [{ ...item('calendar.create'), parameters: { date: 'Friday' } }]);
    const [task] = await plan('alice', 'Book Friday', 'en-GB', 'Europe/Istanbul');
    expect(task.uncertainties).toContain('Confirm the exact calendar date');
  });

  it('rejects malformed model output', async () => {
    const plan = createPlanner(async () => [{ action: 'send-money', parameters: {} }]);
    await expect(plan('alice', 'Send money', 'en-GB', 'Europe/Istanbul')).rejects.toThrow('Invalid task proposal');
  });
});
