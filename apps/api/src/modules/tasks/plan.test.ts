import { describe, expect, it } from 'vitest';
import { createPlanner, PLANNER_INSTRUCTIONS } from './plan.js';

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

  const email = (to: string[], uncertainties: string[] = []) => ({ action: 'email.send', connectionId: null, destination: to.length === 1 ? to[0] : null, parameters: { to, subject: 'Hi', body: 'Hello' }, uncertainties });

  it('asks for confirmation when a recipient address was not written in the instruction', async () => {
    const plan = createPlanner(async () => [email(['invented@example.com'])]);
    const [task] = await plan('alice', 'Email Sam about the agenda', 'en-GB', 'Europe/London');
    expect(task.uncertainties.join(' ')).toContain('recipient address');
  });

  it('accepts a recipient that appears in the instruction, ignoring case', async () => {
    const plan = createPlanner(async () => [email(['sam@example.com'])]);
    const [task] = await plan('alice', 'Email Sam@Example.com about the agenda', 'en-GB', 'Europe/London');
    expect(task.uncertainties).toEqual([]);
  });

  it('flags an email when the instruction says not to send or use something', async () => {
    const plan = createPlanner(async () => [email(['sam@example.com'])]);
    for (const text of ["Email sam@example.com but don't send it to that address", 'Do not use sam@example.com, email sam@example.com anyway', 'Write to sam@example.com, never send this']) {
      const [task] = await plan('alice', text, 'en-GB', 'Europe/London');
      expect(task.uncertainties.join(' ')).toContain('says not to');
    }
  });

  it('does not add a negation warning for ordinary requests', async () => {
    const plan = createPlanner(async () => [email(['sam@example.com'])]);
    const [task] = await plan('alice', "Email sam@example.com and don't forget the agenda", 'en-GB', 'Europe/London');
    expect(task.uncertainties).toEqual([]);
  });

  it('keeps model-written uncertainties and does not duplicate the checks', async () => {
    const plan = createPlanner(async () => [email(['other@example.com'], ['Which address?'])]);
    const [task] = await plan('alice', "Don't send to sam@example.com", 'en-GB', 'Europe/London');
    expect(task.uncertainties[0]).toBe('Which address?');
    expect(new Set(task.uncertainties).size).toBe(task.uncertainties.length);
  });

  it('tells the model to honour retractions and leave doubtful recipients empty', () => {
    expect(PLANNER_INSTRUCTIONS).toMatch(/not to use|do not use|excluded/i);
    expect(PLANNER_INSTRUCTIONS).toMatch(/leave .*recipient.* empty|empty array/i);
    expect(PLANNER_INSTRUCTIONS).toMatch(/question/i);
  });
});

