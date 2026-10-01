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

describe('why a message could not be sent', () => {
  const failed = (status: number, message: string) => Object.assign(new Error(message), { status });
  it('shows a refusal that has its own explanation, and keeps everything else generic', async () => {
    const { sendFailure } = await import('./planResult.js');
    expect(sendFailure(failed(429, 'You are sending messages very quickly.'))).toBe('You are sending messages very quickly.');
    expect(sendFailure(failed(409, 'Start a new conversation to continue.'))).toBe('Start a new conversation to continue.');
    expect(sendFailure(failed(500, 'Request failed (500)'))).toMatch(/still here/);
    expect(sendFailure(new Error('network'))).toMatch(/still here/);
    expect(sendFailure(undefined)).toMatch(/still here/);
  });
});
