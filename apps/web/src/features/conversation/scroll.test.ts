import { describe, expect, it } from 'vitest';
import { isNearBottom, scrollDecision } from './scroll.js';

describe('chat scrolling', () => {
  it('knows whether the reader is at the end of the chat', () => {
    expect(isNearBottom({ scrollTop: 900, clientHeight: 100, scrollHeight: 1000 })).toBe(true);
    expect(isNearBottom({ scrollTop: 840, clientHeight: 100, scrollHeight: 1000 })).toBe(true);
    expect(isNearBottom({ scrollTop: 500, clientHeight: 100, scrollHeight: 1000 })).toBe(false);
    expect(isNearBottom({ scrollTop: 0, clientHeight: 500, scrollHeight: 400 })).toBe(true);
  });

  it('follows new messages for someone at the end or who just sent one, and otherwise offers a jump button', () => {
    expect(scrollDecision(true, false)).toBe('follow');
    expect(scrollDecision(false, true)).toBe('follow');
    expect(scrollDecision(false, false)).toBe('jump-button');
  });
});
