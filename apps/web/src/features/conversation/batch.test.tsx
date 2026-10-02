import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { approveBatch, batchSummary, describeBatch, eligibleForBatch, type BatchTask } from './batch.js';
import { ApproveAll } from './ApproveAll.js';
import { Thread } from './Thread.js';
import { TaskReview } from '../../routes/TaskReview.js';
import { actionNames, trustUnavailable } from '../trust/wording.js';

const task = (id: string, over: Partial<BatchTask> = {}): BatchTask => ({ id, action: 'jira.transition', state: 'proposed', version: 1, uncertainties: [], connectionId: 'jira', destination: 'SFT', ...over });

describe('approving several cards at once', () => {
  it('only counts cards that could be approved on their own', () => {
    expect(eligibleForBatch(task('a'))).toBe(true);
    for (const over of [{ state: 'approved' }, { state: 'rejected' }, { state: 'replaced' }, { uncertainties: ['SFT-2 is already Done.'] }, { connectionId: null }, { destination: null }]) expect(eligibleForBatch(task('x', over)), JSON.stringify(over)).toBe(false);
  });

  it('lists what is in the batch by kind', () => {
    expect(describeBatch([task('a'), task('b'), task('c', { action: 'email.send' })])).toBe('2 × Change Jira status, 1 × Send email');
  });

  it('approves each card on its own, in order, never forcing a changed or already decided one', async () => {
    const order: string[] = [];
    const outcome = await approveBatch([task('a'), task('b'), task('c'), task('d', { uncertainties: ['open question'] })], async t => {
      order.push(t.id);
      if (t.id === 'b') throw Object.assign(new Error('Task changed or was already decided'), { status: 409 });
      return t;
    });
    expect(order).toEqual(['a', 'b', 'c']);
    expect(outcome.approved.map(t => t.id)).toEqual(['a', 'c']);
    expect(outcome.skipped).toEqual([{ task: expect.objectContaining({ id: 'b' }), reason: 'it changed or was already decided' }]);
    expect(batchSummary(3, outcome)).toBe('Approved 2 of 3. Skipped 1: it changed or was already decided.');
  });

  it('keeps going after any failure and reports Jira\'s or the server\'s own reason', async () => {
    const outcome = await approveBatch([task('a'), task('b'), task('c')], async t => {
      if (t.id === 'a') throw Object.assign(new Error('Add the missing issue before approving.'), { status: 422 });
      if (t.id === 'b') throw new Error('network');
      return t;
    });
    expect(outcome.approved.map(t => t.id)).toEqual(['c']);
    expect(outcome.skipped.map(s => s.reason)).toEqual(['Add the missing issue before approving.', 'it could not be saved']);
    expect(batchSummary(3, { approved: [task('a')], skipped: [] })).toContain('Each one is queued and will appear in Activity.');
  });

  it('shows the button only for two or more approvable cards, with the right count', () => {
    const none = renderToStaticMarkup(<ApproveAll tasks={[task('a')]} onDecided={() => {}} />);
    expect(none).toBe('');
    expect(renderToStaticMarkup(<ApproveAll tasks={[task('a'), task('b', { uncertainties: ['x'] })]} onDecided={() => {}} />)).toBe('');
    const html = renderToStaticMarkup(<ApproveAll tasks={[task('a'), task('b'), task('c'), task('d', { state: 'rejected' })]} onDecided={() => {}} />);
    expect(html).toContain('Approve all 3');
    expect(html).not.toContain('Yes, approve');
  });

  it('puts the batch button under the reply that produced the cards', () => {
    const messages = [{ id: '1', role: 'assistant' as const, content: 'Prepared 2.', tasks: [{ id: 't1' }, { id: 't2' }] }];
    const html = renderToStaticMarkup(<Thread messages={messages} renderTask={t => <b>{t.id}</b>} renderTurnFooter={m => <i>footer for {m.id}</i>} />);
    expect(html.indexOf('t2')).toBeLessThan(html.indexOf('footer for 1'));
  });
});

describe('a Jira status change card', () => {
  const card = { id: 't', action: 'jira.transition', version: 1, state: 'proposed', destination: 'SFT', connectionId: 'jira', uncertainties: [], parameters: { issueKey: 'SFT-269', toStatus: 'In Progress', fromStatus: 'To Do', issueTitle: 'Scrum Playbook: Standardize roles', issueTypeId: '', _jiraSiteId: 's', _jiraSiteUrl: 'https://demo.atlassian.net' } };

  it('says plainly what will move from where to where, with the issue title, and nothing about internal fields', () => {
    const html = renderToStaticMarkup(<TaskReview task={card} onChange={() => {}} />);
    expect(html).toContain('Change Jira status');
    expect(html).toContain('Move SFT-269 from To Do to In Progress');
    expect(html).toContain('Scrum Playbook: Standardize roles');
    expect(html).not.toMatch(/issueTypeId|_jiraSite|Jira site/);
    expect(html).toContain('Changes to existing items always need your approval.');
  });

  it('cannot be approved while a question is open, and shows the reason', () => {
    const html = renderToStaticMarkup(<TaskReview task={{ ...card, uncertainties: ['Jira does not allow moving SFT-269 from To Do to Done right now. Available: In Progress.'] }} onChange={() => {}} />);
    expect(html).toContain('Available: In Progress.');
    expect(html).toMatch(/<button[^>]*disabled[^>]*>Approve<\/button>/);
  });

  it('has its own names and is never offered as a trusted action', () => {
    expect(actionNames['jira.transition']).toBe('Change Jira status');
    expect(trustUnavailable('jira.transition')).toMatch(/always need your approval/);
  });
});
