import { useLayoutEffect, useReducer, useRef, type KeyboardEvent } from 'react';
import { MicButton } from '../recording/MicButton.js';
import { sendFailure } from './planResult.js';
import { canRecord, canSend, initialPrompt, promptReducer } from './promptState.js';

const statusText = { idle: '', recording: 'Listening… press the stop button when you are done.', transcribing: 'Transcribing…', sending: 'Kian is thinking…' } as const;

function SendIcon() {
  return <svg aria-hidden="true" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M12 19V5M5 12l7-7 7 7" /></svg>;
}

type Props = { onSubmit: (text: string) => Promise<void>; transcribe: (blob: Blob) => Promise<string> };

export function PromptBox({ onSubmit, transcribe }: Props) {
  const [state, dispatch] = useReducer(promptReducer, initialPrompt);
  const inFlight = useRef(false);
  const field = useRef<HTMLTextAreaElement>(null);
  // Grow with the text (up to the CSS max height) so nothing is hidden behind the icons; follow live dictation.
  useLayoutEffect(() => {
    const el = field.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
    el.scrollTop = el.scrollHeight;
  }, [state.text]);

  async function send() {
    if (inFlight.current || !canSend(state)) return;
    inFlight.current = true;
    dispatch({ type: 'send-start' });
    try { await onSubmit(state.text.trim()); dispatch({ type: 'send-ok' }); }
    catch (error) { dispatch({ type: 'send-failed', message: sendFailure(error) }); }
    finally { inFlight.current = false; }
  }

  async function recorded(blob: Blob) {
    dispatch({ type: 'record-stop' });
    try { dispatch({ type: 'transcribed', text: await transcribe(blob) }); }
    catch (error) { dispatch({ type: 'voice-failed', message: (error as { tooLarge?: boolean }).tooLarge ? 'Recording exceeds 10 MB. Please use a shorter recording.' : 'Transcription failed. Press the microphone to try again, or type the instruction.' }); }
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void send(); }
  }

  const busy = state.status === 'sending';
  return <div className="prompt">
    <div className="prompt-box">
      <textarea ref={field} aria-label="Type an instruction" rows={2} value={state.text} disabled={busy} readOnly={state.status === 'recording'} placeholder="Tell Kian what you need: a Jira story, a meeting, an email, or ask a question" onChange={event => dispatch({ type: 'edit', text: event.target.value })} onKeyDown={onKeyDown} />
      <div className="prompt-actions">
        <MicButton recording={state.status === 'recording'} disabled={!canRecord(state)} onStart={() => dispatch({ type: 'record-start' })} onLive={text => dispatch({ type: 'live', text })} onLiveEnd={() => dispatch({ type: 'live-end' })} onRecorded={blob => void recorded(blob)} onError={message => dispatch({ type: 'voice-failed', message })} />
        <button type="button" className="icon-button send" disabled={!canSend(state)} aria-label="Send instruction" title="Send (Enter)" onClick={() => void send()}>{busy ? <span className="spinner" aria-hidden="true" /> : <SendIcon />}</button>
      </div>
    </div>
    <p className="prompt-status" role="status" aria-live="polite">{statusText[state.status]}</p>
    {state.error && <p role="alert">{state.error}</p>}
  </div>;
}
