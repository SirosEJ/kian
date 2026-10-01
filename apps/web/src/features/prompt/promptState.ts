export type PromptStatus = 'idle' | 'recording' | 'transcribing' | 'sending';
export type PromptState = { text: string; status: PromptStatus; error: string; base: string; draft: string };
export type PromptAction =
  | { type: 'edit'; text: string }
  | { type: 'record-start' }
  | { type: 'record-stop' }
  | { type: 'live'; text: string }
  | { type: 'live-end' }
  | { type: 'transcribed'; text: string }
  | { type: 'voice-failed'; message: string }
  | { type: 'send-start' }
  | { type: 'send-ok' }
  | { type: 'send-failed'; message: string };

export const initialPrompt: PromptState = { text: '', status: 'idle', error: '', base: '', draft: '' };

/** Append dictated speech to whatever the user has already typed, separated by one space. */
export function joinTranscript(current: string, transcript: string): string {
  const spoken = transcript.trim();
  if (!spoken) return current;
  if (!current.trim()) return spoken;
  return /\s$/.test(current) ? `${current}${spoken}` : `${current} ${spoken}`;
}

/** Build the running transcript from a speech-recognition result list (final and interim parts, in order). */
export function collectTranscript(results: ArrayLike<{ 0: { transcript: string } }>): string {
  let text = '';
  for (let i = 0; i < results.length; i++) text += results[i][0].transcript;
  return text.replace(/\s+/g, ' ').trim();
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
    case 'record-start': return canRecord(state) ? { ...state, status: 'recording', error: '', base: state.text } : state;
    case 'record-stop': return state.status === 'recording' ? { ...state, status: 'transcribing' } : state;
    case 'live': return state.status === 'recording' ? { ...state, text: joinTranscript(state.base, action.text) } : state;
    case 'live-end': return state.status === 'recording' ? { ...state, status: 'idle' } : state;
    case 'transcribed': return { ...state, status: state.status === 'transcribing' ? 'idle' : state.status, text: joinTranscript(state.text, action.text) };
    case 'voice-failed': return { ...state, status: state.status === 'sending' ? 'sending' : 'idle', error: action.message };
    // The box empties as soon as the message is sent, like a chat app; the text is kept aside in case sending fails.
    case 'send-start': return canSend(state) ? { ...state, status: 'sending', error: '', draft: state.text, text: '' } : state;
    case 'send-ok': return state.status === 'sending' ? { ...initialPrompt, text: state.text } : state;
    case 'send-failed': return state.status === 'sending' ? { ...state, status: 'idle', error: action.message, text: joinTranscript(state.draft, state.text), draft: '' } : state;
  }
}
