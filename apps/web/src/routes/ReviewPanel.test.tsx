import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { ReviewPanel, reviewOf } from './ReviewPanel.js';
import { TaskReview } from './TaskReview.js';
import { safetyChecks } from '../features/trust/wording.js';

const review = { matched: 'The event "Planning" in your calendar, found by the id from an agenda Kian showed you.', changes: [{ field: 'When', before: 'Sat 3 Oct 10:00–10:30', after: 'Sat 3 Oct 16:00–16:30' }, { field: 'Title', before: 'Planning', after: 'Planning v2' }] };

describe('the review on an approval card', () => {
  it('shows what will change (now and after), how it was matched, and the safety checks', () => {
    const html = renderToStaticMarkup(<ReviewPanel action="calendar.update" parameters={{ eventId: 'abc', _review: review }} />);
    expect(html).toContain('What will change');
    expect(html).toContain('Now');
    expect(html).toContain('After you approve');
    expect(html).toContain('Sat 3 Oct 16:00–16:30');
    expect(html).toContain('How Kian matched this');
    expect(html).toContain('found by the id from an agenda Kian showed you');
    expect(html).toContain('Safety checks');
    expect(html).toContain('Nothing happens until you press Approve.');
    expect(html).toContain('never done automatically');
  });

  it('still lists the safety checks when there is no review, and leaves out the change table when nothing is listed', () => {
    const none = renderToStaticMarkup(<ReviewPanel action="email.send" parameters={{ to: ['sam@example.com'] }} />);
    expect(none).toContain('Each recipient must be an address written out in what you said.');
    expect(none).not.toContain('What will change');
    expect(none).not.toContain('How Kian matched this');
    const empty = renderToStaticMarkup(<ReviewPanel action="jira.update" parameters={{ _review: { matched: 'SFT-1 exists.', changes: [] } }} />);
    expect(empty).not.toContain('What will change');
    expect(empty).toContain('SFT-1 exists.');
  });

  it('ignores a review that is not in the expected shape', () => {
    expect(reviewOf(undefined)).toBeNull();
    expect(reviewOf({ _review: 'text' })).toBeNull();
    expect(reviewOf({ _review: { matched: 1, changes: [] } })).toBeNull();
    expect(reviewOf({ _review: { matched: 'x', changes: [{ field: 1 }, { field: 'a', before: 'b', after: 'c' }] } })?.changes).toEqual([{ field: 'a', before: 'b', after: 'c' }]);
  });

  it('names the checks that fit each action', () => {
    expect(safetyChecks('jira.transition').join(' ')).toMatch(/Jira allows this move/);
    expect(safetyChecks('jira.update').join(' ')).toMatch(/project chosen in Settings/);
    expect(safetyChecks('calendar.delete').join(' ')).toMatch(/cannot be brought back/);
    expect(safetyChecks('calendar.create')).toEqual(['Nothing happens until you press Approve.']);
  });

  it('appears on the card without showing the internal review data as a detail', () => {
    const html = renderToStaticMarkup(<TaskReview task={{ id: 'u', action: 'calendar.update', state: 'proposed', version: 1, destination: 'me@example.com', connectionId: 'cal', parameters: { eventId: 'abc', summary: 'Planning v2', _review: review }, uncertainties: [] }} onChange={() => {}} />);
    expect(html).toContain('What will change');
    expect(html).toContain('Planning v2');
    expect(html).not.toContain('_review');
    expect(html).not.toContain('[object Object]');
  });
});
