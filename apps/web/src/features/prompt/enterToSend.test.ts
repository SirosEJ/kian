import { afterEach, describe, expect, it, vi } from 'vitest';
import { enterHint, enterSends, sendsMessage, setEnterSends, type KeyPress } from './enterToSend.js';

const press = (over: Partial<KeyPress> = {}): KeyPress => ({ key: 'Enter', shiftKey: false, ctrlKey: false, metaKey: false, isComposing: false, ...over });
const memory = () => { const data = new Map<string, string>(); return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v) }; };

describe('which key presses send the message', () => {
  it('Enter sends by default, Shift+Enter adds a line, and nothing sends while an input method is composing', () => {
    expect(sendsMessage(press(), true)).toBe(true);
    expect(sendsMessage(press({ shiftKey: true }), true)).toBe(false);
    expect(sendsMessage(press({ isComposing: true }), true)).toBe(false);
    expect(sendsMessage(press({ key: 'a' }), true)).toBe(false);
    expect(sendsMessage(press({ key: ' ' }), true)).toBe(false);
  });
  it('with the setting off, Enter adds a line; Ctrl+Enter and Cmd+Enter still send; composing never sends', () => {
    expect(sendsMessage(press(), false)).toBe(false);
    expect(sendsMessage(press({ shiftKey: true }), false)).toBe(false);
    expect(sendsMessage(press({ ctrlKey: true }), false)).toBe(true);
    expect(sendsMessage(press({ metaKey: true }), false)).toBe(true);
    expect(sendsMessage(press({ ctrlKey: true, isComposing: true }), false)).toBe(false);
  });
  it('Ctrl+Enter also sends when Enter sends (nothing is lost by turning the setting on)', () => {
    expect(sendsMessage(press({ ctrlKey: true }), true)).toBe(true);
  });
});

describe('the saved preference', () => {
  afterEach(() => vi.unstubAllGlobals());
  it('is on by default, can be turned off and on, and takes effect at once', () => {
    vi.stubGlobal('localStorage', memory());
    expect(enterSends()).toBe(true);
    setEnterSends(false);
    expect(enterSends()).toBe(false);
    setEnterSends(true);
    expect(enterSends()).toBe(true);
  });
  it('falls back to Enter sends when the browser blocks storage, and never throws', () => {
    vi.stubGlobal('localStorage', { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } });
    expect(enterSends()).toBe(true);
    expect(() => setEnterSends(false)).not.toThrow();
    vi.unstubAllGlobals();
    expect(enterSends()).toBe(true);
  });
  it('says in words what Enter does for each choice', () => {
    expect(enterHint(true)).toBe('Press Enter to send, Shift+Enter for a new line.');
    expect(enterHint(false)).toBe('Press Ctrl+Enter or the Send button to send. Enter adds a new line.');
  });
});
