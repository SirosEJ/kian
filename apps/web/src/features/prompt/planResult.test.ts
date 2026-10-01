import { describe, expect, it } from 'vitest';
import { describePlanResult } from './planResult.js';

describe('describePlanResult', () => {
  it('shows Kian\'s reply, trimmed, and no extra note', () => {
    expect(describePlanResult({ reply: '  I prepared 1 action for you to review. ', tasks: [{}] })).toEqual({ reply: 'I prepared 1 action for you to review.', notice: '' });
  });
  it('shows the explanation alone when nothing was prepared', () => {
    expect(describePlanResult({ reply: 'I cannot book flights.', tasks: [] })).toEqual({ reply: 'I cannot book flights.', notice: '' });
  });
  it('falls back to a note only when there is neither a reply nor a task', () => {
    expect(describePlanResult({ reply: '', tasks: [] }).notice).toMatch(/did not create any tasks/);
    expect(describePlanResult({}).notice).toMatch(/did not create any tasks/);
    expect(describePlanResult({ tasks: [{}] })).toEqual({ reply: '', notice: '' });
  });
  it('ignores a reply that is not text', () => {
    expect(describePlanResult({ reply: 42, tasks: [] }).reply).toBe('');
  });
});
