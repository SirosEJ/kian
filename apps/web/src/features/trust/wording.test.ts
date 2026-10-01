import { describe, expect, it } from 'vitest';
import { activityTitle, decisionError, eventLabel, ruleSentence, trustPrompt, trustUnavailable } from './wording.js';

describe('trust and activity wording', () => {
  it('spells out exactly what trusting a task means, including how to undo it', () => {
    const text = trustPrompt('email.send', 'sam@example.com', 'Work mailbox');
    expect(text).toContain('send email to sam@example.com using Work mailbox');
    expect(text).toMatch(/different recipient.*ask/i);
    expect(text).toContain('Settings');
    expect(trustPrompt('jira.create', 'SFT', 'Jira Cloud')).toContain('create issues in Jira project SFT using Jira Cloud');
    expect(trustPrompt('calendar.create', 'primary')).toContain('create events in calendar primary');
    expect(trustPrompt('calendar.create', 'primary')).not.toContain(' using ');
  });

  it('explains why updates cannot be trusted', () => {
    expect(trustUnavailable('calendar.update')).toMatch(/always need your approval/);
    expect(trustUnavailable('jira.update')).not.toBeNull();
    expect(trustUnavailable('email.send')).toBeNull();
  });

  it('describes a saved rule with its connection', () => {
    expect(ruleSentence({ action: 'email.send', constraints: { destinations: ['sam@example.com'] }, connection_name: 'Work mailbox' })).toBe('Send email to sam@example.com using Work mailbox');
    expect(ruleSentence({ action: 'jira.create', constraints: { destinations: ['SFT'] } })).toBe('Create issues in Jira project SFT');
  });

  it('says how every activity event came about', () => {
    expect(eventLabel('task.approved')).toBe('Approved by you');
    expect(eventLabel('task.trusted')).toMatch(/automatically.*trusted action/);
    expect(eventLabel('task.uncertain')).toMatch(/check the result/);
    expect(eventLabel('task.failed')).toMatch(/nothing was changed/);
    expect(eventLabel('task.something.new')).toBe('something new');
  });

  it('titles activity with the task, and copes with a task that is gone', () => {
    expect(activityTitle('email.send', 'sam@example.com')).toBe('Send email to sam@example.com');
    expect(activityTitle('calendar.create', null)).toBe('Create calendar event');
    expect(activityTitle(null, null)).toBe('Task');
  });

  it('shows the server\'s reason when an approval is refused, and a generic hint otherwise', () => {
    expect(decisionError(Object.assign(new Error('Add the missing subject before approving.'), { status: 422 }))).toBe('Add the missing subject before approving.');
    expect(decisionError(Object.assign(new Error('Request failed (409)'), { status: 409 }))).toMatch(/Refresh and review/);
    expect(decisionError(new Error('network'))).toMatch(/Refresh and review/);
  });
});

