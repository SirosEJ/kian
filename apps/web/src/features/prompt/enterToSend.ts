/**
 * Whether the Enter key sends the message (the default, as in most chat apps) or adds a new line. Kept per device in the browser,
 * because it depends on the keyboard: a phone keyboard or a screen reader may want Enter to add a line and the Send button to send.
 * Ctrl+Enter and Cmd+Enter always send, and Shift+Enter always adds a line.
 */
const KEY = 'kian.enterSends';

export function enterSends(): boolean {
  try { return localStorage.getItem(KEY) !== 'off'; } catch { return true; }
}
export function setEnterSends(on: boolean): void {
  try { localStorage.setItem(KEY, on ? 'on' : 'off'); } catch { /* private window or blocked storage: the default stays */ }
}

export type KeyPress = { key: string; shiftKey: boolean; ctrlKey: boolean; metaKey: boolean; isComposing: boolean };
/** Does this key press send the message? Never while an input method is composing text. */
export function sendsMessage(press: KeyPress, enterSendsMessage: boolean): boolean {
  if (press.key !== 'Enter' || press.isComposing) return false;
  if (press.ctrlKey || press.metaKey) return true;
  return enterSendsMessage && !press.shiftKey;
}

/** The text read out for the input and shown as its hint. */
export function enterHint(enterSendsMessage: boolean): string {
  return enterSendsMessage ? 'Press Enter to send, Shift+Enter for a new line.' : 'Press Ctrl+Enter or the Send button to send. Enter adds a new line.';
}
