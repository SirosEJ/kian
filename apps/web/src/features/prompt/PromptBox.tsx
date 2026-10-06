import { useEffect, useLayoutEffect, useReducer, useRef, useState, type KeyboardEvent } from 'react';
import { MicButton } from '../recording/MicButton.js';
import { sendFailure } from './planResult.js';
import { canRecord, canSend, dictationEdit, initialPrompt, promptReducer } from './promptState.js';
import { applyCorrections, type Correction } from './corrections.js';
import { enterHint, enterSends, sendsMessage } from './enterToSend.js';

const statusText = { idle: '', recording: 'Listening… press the stop button when you are done.', transcribing: 'Transcribing…', sending: '' } as const;

function SendIcon() {
  return <svg aria-hidden="true" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M12 19V5M5 12l7-7 7 7" /></svg>;
}

type Props = {
  onSubmit: (text: string) => Promise<void>; transcribe: (blob: Blob) => Promise<string>;
  /** Spoken forms the user has corrected before, applied to live dictation as it appears. */
  corrections?: Correction[];
  /** Called after a send when the user changed dictated words, so Kian can learn the correction. Never blocks sending. */
  onDictationEdit?: (edit: { dictated: string; final: string }) => void;
};

export function PromptBox({ onSubmit, transcribe, corrections = [], onDictationEdit }: Props) {
  const [state, dispatch] = useReducer(promptReducer, initialPrompt);
  const inFlight = useRef(false);
  const field = useRef<HTMLTextAreaElement>(null);
  const [enterOn] = useState(enterSends);
  const [ready, setReady] = useState(false);
  const before = useRef(state.status);
  // When dictation ends: say so (screen readers), and on a computer put the cursor back in the box, so that Enter sends the text
  // instead of pressing the microphone button again. A phone is left alone: focusing the box would open its keyboard.
  useEffect(() => {
    const was = before.current;
    before.current = state.status;
    if (state.status !== 'idle') { setReady(false); return; }
    if ((was === 'recording' || was === 'transcribing') && state.text.trim() && !state.error) {
      setReady(true);
      if (typeof window.matchMedia === 'function' && window.matchMedia('(pointer: fine)').matches) field.current?.focus();
    }
  }, [state.status]); // eslint-disable-line react-hooks/exhaustive-deps
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
    const edit = dictationEdit(state.dictated, state.text);
    try { await onSubmit(state.text.trim()); dispatch({ type: 'send-ok' }); if (edit) onDictationEdit?.(edit); }
    catch (error) { dispatch({ type: 'send-failed', message: sendFailure(error) }); }
    finally { inFlight.current = false; }
  }

  async function recorded(blob: Blob) {
    dispatch({ type: 'record-stop' });
    try { dispatch({ type: 'transcribed', text: await transcribe(blob) }); }
    catch (error) { dispatch({ type: 'voice-failed', message: (error as { tooLarge?: boolean }).tooLarge ? 'Recording exceeds 10 MB. Please use a shorter recording.' : 'Transcription failed. Press the microphone to try again, or type the instruction.' }); }
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    // The setting is read at every key press, so changing it in Settings applies at once.
    if (sendsMessage({ key: event.key, shiftKey: event.shiftKey, ctrlKey: event.ctrlKey, metaKey: event.metaKey, isComposing: event.nativeEvent.isComposing }, enterSends())) { event.preventDefault(); void send(); }
  }

  const busy = state.status === 'sending';
  return <div className="prompt">
    <div className="prompt-box">
      <textarea ref={field} aria-label="Type an instruction" aria-describedby="prompt-hint prompt-status" rows={2} value={state.text} readOnly={state.status === 'recording'} placeholder="Tell Kian what you need: a Jira story, a meeting, an email, or ask a question" onChange={event => { setReady(false); dispatch({ type: 'edit', text: event.target.value }); }} onKeyDown={onKeyDown} />
      <div className="prompt-actions">
        <MicButton recording={state.status === 'recording'} disabled={!canRecord(state)} onStart={() => dispatch({ type: 'record-start' })} onLive={text => dispatch({ type: 'live', text: applyCorrections(text, corrections) })} onLiveEnd={() => dispatch({ type: 'live-end' })} onRecorded={blob => void recorded(blob)} onError={message => dispatch({ type: 'voice-failed', message })} />
        <button type="button" className="icon-button send" disabled={!canSend(state)} aria-label="Send instruction" title={enterOn ? 'Send (Enter)' : 'Send (Ctrl+Enter)'} onClick={() => void send()}>{busy ? <span className="spinner" aria-hidden="true" /> : <SendIcon />}</button>
      </div>
    </div>
    <p id="prompt-hint" className="sr-only">{enterHint(enterOn)}</p>
    <p id="prompt-status" className="prompt-status" role="status" aria-live="polite">{statusText[state.status] || (ready ? (enterOn ? 'Dictation ready. Edit it if needed, then press Enter to send.' : 'Dictation ready. Edit it if needed, then press the Send button.') : '')}</p>
    {state.error && <p role="alert">{state.error}</p>}
  </div>;
}
