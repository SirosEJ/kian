export type PromptStatus = 'idle' | 'recording' | 'transcribing' | 'sending';
export type PromptState = { text: string; status: PromptStatus; error: string };
export type PromptAction =
  | { type: 'edit'; text: string }
  | { type: 'record-start' }
  | { type: 'record-stop' }
  | { type: 'transcribed'; text: string }
  | { type: 'voice-failed'; message: string }
  | { type: 'send-start' }
  | { type: 'send-ok' }
  | { type: 'send-failed'; message: string };

export const initialPrompt: PromptState = { text: '', status: 'idle', error: '' };

/** Append dictated speech to whatever the user has already typed, separated by one space. */
export function joinTranscript(current: string, transcript: string): string {
  const spoken = transcript.trim();
  if (!spoken) return current;
  if (!current.trim()) return spoken;
  return /\s$/.test(current) ? `${current}${spoken}` : `${current} ${spoken}`;
}

export function canSend(state: PromptState): boolean {
  return state.status === 'idle' && state.text.trim().length > 0;
}

export function canRecord(state: PromptState): boolean {
  return state.status === 'idle' || state.status === 'recording';
}

export function promptReducer(state: PromptState, action: PromptAction): PromptState {
  switch (action.type) {
    case 'edit': return { ...state, text: action.text };
    case 'record-start': return canRecord(state) ? { ...state, status: 'recording', error: '' } : state;
    case 'record-stop': return state.status === 'recording' ? { ...state, status: 'transcribing' } : state;
    case 'transcribed': return { ...state, status: state.status === 'transcribing' ? 'idle' : state.status, text: joinTranscript(state.text, action.text) };
    case 'voice-failed': return { ...state, status: state.status === 'sending' ? 'sending' : 'idle', error: action.message };
    case 'send-start': return canSend(state) ? { ...state, status: 'sending', error: '' } : state;
    case 'send-ok': return state.status === 'sending' ? { text: '', status: 'idle', error: '' } : state;
    case 'send-failed': return state.status === 'sending' ? { ...state, status: 'idle', error: action.message } : state;
  }
}
