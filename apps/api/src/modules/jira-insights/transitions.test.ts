import { describe, expect, it } from 'vitest';
import { JiraReadError } from '@kian/connectors';
import type { TaskProposal } from '@kian/contracts';
import { checkTransition, prepareTransitions, type TransitionChecker, type TransitionReader } from './transitions.js';

const connection = { accessToken: 'secret-token', siteId: 'site-1', siteUrl: 'https://demo.atlassian.net' };
const reader = (over: Partial<{ project: string; status: string; options: { id: string; name: string; to: string }[]; fail: JiraReadError | Error }> = {}): TransitionReader & { calls: string[] } => {
  const calls: string[] = [];
  return {
    calls,
    brief: async (_c, key) => { calls.push(`brief ${key}`); if (over.fail) throw over.fail; return { key, summary: `Title of ${key}`, status: over.status ?? 'To Do', projectKey: over.project ?? 'SFT' }; },
    transitions: async (_c, key) => { calls.push(`transitions ${key}`); return over.options ?? [{ id: '21', name: 'Start', to: 'In Progress' }, { id: '31', name: 'Finish', to: 'Done' }]; },
  };
};
const move = (issueKey: unknown, toStatus: unknown = 'In Progress', over: Partial<TaskProposal> = {}): TaskProposal => ({ id: `t-${String(issueKey)}`, action: 'jira.transition', connectionId: null, destination: null, parameters: { issueKey, toStatus }, uncertainties: [], state: 'proposed', ...over }) as TaskProposal;

describe('checking a status change with Jira', () => {
  it('accepts a move Jira offers, using Jira\'s own status name and the issue title', async () => {
    const result = await checkTransition(reader(), connection, 'SFT', 'SFT-269', 'in progress');
    expect(result).toEqual({ ok: true, title: 'Title of SFT-269', from: 'To Do', to: 'In Progress', projectKey: 'SFT' });
  });

  it('refuses until a project is chosen in Settings, before asking Jira anything', async () => {
    const r = reader();
    const result = await checkTransition(r, connection, null, 'SFT-269', 'Done');
    expect(result).toMatchObject({ ok: false, reason: expect.stringContaining('Choose the Jira project under Settings') });
    expect(r.calls).toEqual([]);
  });

  it('refuses an issue from another project', async () => {
    const result = await checkTransition(reader({ project: 'OTHER' }), connection, 'SFT', 'OTHER-5', 'Done');
    expect(result).toMatchObject({ ok: false, reason: expect.stringContaining('project selected in Settings is SFT') });
  });

  it('says so when the issue is already in that status', async () => {
    expect(await checkTransition(reader({ status: 'In Progress' }), connection, 'SFT', 'SFT-1', 'In Progress')).toEqual({ ok: false, reason: 'SFT-1 is already In Progress.' });
  });

  it('names what is available when the workflow does not allow the move', async () => {
    const result = await checkTransition(reader(), connection, 'SFT', 'SFT-1', 'Blocked');
    expect(result).toMatchObject({ ok: false, reason: 'Jira does not allow moving SFT-1 from To Do to Blocked right now. Available: In Progress, Done.' });
  });

  it('asks for a missing key or status instead of guessing', async () => {
    expect(await checkTransition(reader(), connection, 'SFT', '269', 'Done')).toMatchObject({ ok: false, reason: expect.stringContaining('I need its key') });
    expect(await checkTransition(reader(), connection, 'SFT', 'SFT-1', '  ')).toMatchObject({ ok: false, reason: 'Which status should it move to?' });
  });

  it('turns Jira problems into plain reasons without leaking anything', async () => {
    expect(await checkTransition(reader({ fail: new JiraReadError('failed', 'Jira did not answer (404).') }), connection, 'SFT', 'SFT-999', 'Done')).toEqual({ ok: false, reason: 'Jira could not find or open SFT-999.' });
    expect(await checkTransition(reader({ fail: new JiraReadError('expired', 'Jira access expired. Reconnect Jira in Settings.') }), connection, 'SFT', 'SFT-1', 'Done')).toMatchObject({ reason: 'Jira access expired. Reconnect Jira in Settings.' });
    const unknown = await checkTransition(reader({ fail: new Error('boom secret-token') }), connection, 'SFT', 'SFT-1', 'Done');
    expect(JSON.stringify(unknown)).not.toContain('secret-token');
  });
});

describe('preparing a batch of status changes', () => {
  const ok: TransitionChecker = async (_o, key, to) => ({ ok: true, title: `Title ${key}`, from: 'To Do', to: to.replace(/^in progress$/i, 'In Progress'), projectKey: 'SFT' });

  it('fills in the current status, title, exact status name and project on each card', async () => {
    const [task] = await prepareTransitions(ok, 'alice', [move('sft-269', 'in progress')], 'SFT');
    expect(task).toMatchObject({ destination: 'SFT', uncertainties: [], parameters: { issueKey: 'SFT-269', toStatus: 'In Progress', fromStatus: 'To Do', issueTitle: 'Title SFT-269' } });
    // The card also says how it was matched and what changes, from Jira's own answer.
    expect(task.parameters._review).toEqual({ matched: 'SFT-269 "Title SFT-269" exists in Jira project SFT (the project chosen in Settings), and Jira allows this move right now.', changes: [{ field: 'Status', before: 'To Do', after: 'In Progress' }] });
  });

  it('turns a bare number into a key in the chosen project', async () => {
    const [task] = await prepareTransitions(ok, 'alice', [move('269')], 'SFT');
    expect(task.parameters.issueKey).toBe('SFT-269');
  });

  it('adds the reason to a card that cannot be approved and leaves the others alone', async () => {
    const check: TransitionChecker = async (_o, key) => (key === 'SFT-2' ? { ok: false, reason: 'SFT-2 is already Done.' } : ok(_o, key, 'Done'));
    const tasks = await prepareTransitions(check, 'alice', [move('SFT-1', 'Done'), move('SFT-2', 'Done')], 'SFT');
    expect(tasks[0].uncertainties).toEqual([]);
    expect(tasks[1].uncertainties).toEqual(['SFT-2 is already Done.']);
  });

  it('flags the same issue asked for twice, and does not check it twice', async () => {
    const asked: string[] = [];
    const check: TransitionChecker = async (o, key, to) => { asked.push(key); return ok(o, key, to); };
    const tasks = await prepareTransitions(check, 'alice', [move('SFT-1'), move('SFT-1')], 'SFT');
    expect(asked).toEqual(['SFT-1']);
    expect(tasks[1].uncertainties[0]).toContain('appears more than once');
  });

  it('cannot be approved when Jira is not connected', async () => {
    const tasks = await prepareTransitions(async () => null, 'alice', [move('SFT-1')], 'SFT');
    expect(tasks[0].uncertainties).toEqual(['Jira is not connected. Connect it under Settings first.']);
    expect((await prepareTransitions(undefined, 'alice', [move('SFT-1')], 'SFT'))[0].uncertainties).toHaveLength(1);
  });

  it('passes other kinds of proposals through untouched and keeps order', async () => {
    const mail = { id: 'm', action: 'email.send', connectionId: null, destination: 'a@b.co', parameters: { to: ['a@b.co'] }, uncertainties: [], state: 'proposed' } as TaskProposal;
    const tasks = await prepareTransitions(ok, 'alice', [mail, move('SFT-1'), mail], 'SFT');
    expect(tasks[0]).toBe(mail);
    expect(tasks[2]).toBe(mail);
    expect(tasks[1].action).toBe('jira.transition');
  });

  it('checks many issues a few at a time, for the asking user only', async () => {
    let running = 0, peak = 0;
    const owners = new Set<string>();
    const check: TransitionChecker = async (o, key, to) => { owners.add(o); running++; peak = Math.max(peak, running); await new Promise(r => setTimeout(r, 5)); running--; return ok(o, key, to); };
    const tasks = await prepareTransitions(check, 'alice', Array.from({ length: 12 }, (_, i) => move(`SFT-${i + 1}`)), 'SFT');
    expect(tasks.every(t => t.uncertainties.length === 0)).toBe(true);
    expect(peak).toBeLessThanOrEqual(5);
    expect([...owners]).toEqual(['alice']);
  });
});
