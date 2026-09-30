import { describe, expect, it } from 'vitest';
import { canSend, initialPrompt, joinTranscript, promptReducer, type PromptAction, type PromptState } from './promptState.js';

const run = (actions: PromptAction[], from: PromptState = initialPrompt) => actions.reduce(promptReducer, from);

describe('prompt dictation and send', () => {
  it('records, transcribes into the box, and lets the user append more speech', () => {
    let state = run([{ type: 'record-start' }]);
    expect(state.status).toBe('recording');
    state = run([{ type: 'record-stop' }, { type: 'transcribed', text: ' Book a meeting with Sam ' }], state);
    expect(state).toMatchObject({ status: 'idle', text: 'Book a meeting with Sam' });
    state = run([{ type: 'record-start' }, { type: 'record-stop' }, { type: 'transcribed', text: 'on Friday at 3pm' }], state);
    expect(state.text).toBe('Book a meeting with Sam on Friday at 3pm');
  });

  it('keeps text the user typed while speech is being transcribed', () => {
    const state = run([{ type: 'edit', text: 'Email Alex' }, { type: 'record-start' }, { type: 'record-stop' }, { type: 'edit', text: 'Email Alex about' }, { type: 'transcribed', text: 'the agenda' }]);
    expect(state.text).toBe('Email Alex about the agenda');
  });

  it('joins transcripts with a single space and ignores empty speech', () => {
    expect(joinTranscript('', ' hello ')).toBe('hello');
    expect(joinTranscript('hello', 'world')).toBe('hello world');
    expect(joinTranscript('hello ', 'world')).toBe('hello world');
    expect(joinTranscript('hello', '   ')).toBe('hello');
  });

  it('only sends non-empty text when idle, and never twice', () => {
    expect(canSend(initialPrompt)).toBe(false);
    expect(canSend(run([{ type: 'edit', text: '   ' }]))).toBe(false);
    const typed = run([{ type: 'edit', text: 'Create a Jira story' }]);
    expect(canSend(typed)).toBe(true);
    const sending = run([{ type: 'send-start' }], typed);
    expect(sending.status).toBe('sending');
    expect(canSend(sending)).toBe(false);
    expect(run([{ type: 'send-start' }], sending)).toBe(sending);
  });

  it('cannot send while recording or transcribing', () => {
    const recording = run([{ type: 'edit', text: 'x' }, { type: 'record-start' }]);
    expect(run([{ type: 'send-start' }], recording).status).toBe('recording');
    const transcribing = run([{ type: 'record-stop' }], recording);
    expect(run([{ type: 'send-start' }], transcribing).status).toBe('transcribing');
  });

  it('clears the box after a successful send and keeps it after a failure', () => {
    const sending = run([{ type: 'edit', text: 'Do the thing' }, { type: 'send-start' }]);
    expect(run([{ type: 'send-ok' }], sending)).toEqual(initialPrompt);
    const failed = run([{ type: 'send-failed', message: 'Could not prepare tasks.' }], sending);
    expect(failed).toEqual({ text: 'Do the thing', status: 'idle', error: 'Could not prepare tasks.' });
  });

  it('keeps typed text and shows a retryable message when dictation fails', () => {
    const state = run([{ type: 'edit', text: 'Email Alex' }, { type: 'record-start' }, { type: 'record-stop' }, { type: 'voice-failed', message: 'Transcription failed.' }]);
    expect(state).toEqual({ text: 'Email Alex', status: 'idle', error: 'Transcription failed.' });
    expect(run([{ type: 'record-start' }], state)).toMatchObject({ status: 'recording', error: '' });
  });
});
