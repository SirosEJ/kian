export type ScrollBox = { scrollTop: number; clientHeight: number; scrollHeight: number };

/** True when the reader is at (or within `slack` pixels of) the end of the chat, so new messages should follow them down. */
export function isNearBottom(box: ScrollBox, slack = 80): boolean {
  return box.scrollHeight - box.scrollTop - box.clientHeight <= slack;
}

/** Follow new messages only for a reader who is already at the end; someone reading older messages gets a "jump to latest" button instead. */
export function scrollDecision(wasAtBottom: boolean, justSent: boolean): 'follow' | 'jump-button' {
  return wasAtBottom || justSent ? 'follow' : 'jump-button';
}
