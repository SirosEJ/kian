import { describe, expect, it } from 'vitest';
import { canSend, collectTranscript, dictationEdit, initialPrompt, joinTranscript, promptReducer, type PromptAction, type PromptState } from './promptState.js';

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
    expect(failed).toMatchObject({ text: 'Do the thing', status: 'idle', error: 'Could not prepare tasks.' });
  });

  it('keeps typed text and shows a retryable message when dictation fails', () => {
    const state = run([{ type: 'edit', text: 'Email Alex' }, { type: 'record-start' }, { type: 'record-stop' }, { type: 'voice-failed', message: 'Transcription failed.' }]);
    expect(state).toMatchObject({ text: 'Email Alex', status: 'idle', error: 'Transcription failed.' });
    expect(run([{ type: 'record-start' }], state)).toMatchObject({ status: 'recording', error: '' });
  });
});

describe('live dictation', () => {
  it('shows speech in the box as it is recognised, after whatever was already typed', () => {
    let state = run([{ type: 'edit', text: 'Email Alex' }, { type: 'record-start' }]);
    state = run([{ type: 'live', text: 'about' }], state);
    expect(state.text).toBe('Email Alex about');
    state = run([{ type: 'live', text: 'about the agenda for Friday' }], state);
    expect(state.text).toBe('Email Alex about the agenda for Friday');
    state = run([{ type: 'live-end' }], state);
    expect(state).toMatchObject({ status: 'idle', text: 'Email Alex about the agenda for Friday' });
  });

  it('ignores late live results once recording has ended, and cannot send while listening', () => {
    const recording = run([{ type: 'edit', text: 'x' }, { type: 'record-start' }, { type: 'live', text: 'y' }]);
    expect(run([{ type: 'send-start' }], recording).status).toBe('recording');
    const ended = run([{ type: 'live-end' }], recording);
    expect(run([{ type: 'live', text: 'late' }], ended).text).toBe('x y');
  });

  it('starts the next dictation from the edited text', () => {
    let state = run([{ type: 'record-start' }, { type: 'live', text: 'first' }, { type: 'live-end' }, { type: 'edit', text: 'First, edited' }, { type: 'record-start' }, { type: 'live', text: 'second' }]);
    expect(state.text).toBe('First, edited second');
  });

  it('builds the running transcript from final and interim results', () => {
    expect(collectTranscript([{ 0: { transcript: 'hello ' } }, { 0: { transcript: ' wor' } }])).toBe('hello wor');
    expect(collectTranscript([])).toBe('');
  });

  it('empties the box when a message is sent and puts the text back if sending fails', () => {
    const sending = run([{ type: 'edit', text: 'Book a meeting' }, { type: 'send-start' }]);
    expect(sending.text).toBe('');
    const failed = run([{ type: 'send-failed', message: 'x' }], sending);
    expect(failed).toMatchObject({ status: 'idle', text: 'Book a meeting', error: 'x' });
  });
});

describe('noticing what the user changed after dictating', () => {
  it('remembers the dictated text when speech ends, live or recorded, and clears it after a send', () => {
    let state = run([{ type: 'record-start' }, { type: 'live', text: 'email Seros' }, { type: 'live-end' }]);
    expect(state.dictated).toBe('email Seros');
    state = run([{ type: 'edit', text: 'email Siros' }], state);
    expect(state.dictated).toBe('email Seros');
    state = run([{ type: 'record-start' }, { type: 'record-stop' }, { type: 'transcribed', text: 'ask Sol man' }], initialPrompt);
    expect(state.dictated).toBe('ask Sol man');
    expect(run([{ type: 'send-start' }, { type: 'send-ok' }], state).dictated).toBe('');
  });
  it('reports an edit only when dictated text was changed before sending', () => {
    expect(dictationEdit('email Seros', 'email Siros')).toEqual({ dictated: 'email Seros', final: 'email Siros' });
    expect(dictationEdit('email Seros', ' email Seros ')).toBeNull();
    expect(dictationEdit('', 'typed only')).toBeNull();
    expect(dictationEdit('something', '')).toBeNull();
  });
});
