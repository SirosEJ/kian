import { useRef } from 'react';
import { collectTranscript } from '../prompt/promptState.js';

const unavailable = 'Voice recording is unavailable in this browser. Type your instruction instead.';
const blocked = 'Microphone access is blocked. Allow the microphone for this site in your browser settings, then try again.';

export function MicIcon() {
  return <svg aria-hidden="true" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3" /></svg>;
}
export function StopIcon() {
  return <svg aria-hidden="true" viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2" /></svg>;
}

// Minimal typing for the browser speech-recognition API (Chrome, Edge, Safari), which TypeScript's DOM lib omits.
type RecognitionEvent = { results: ArrayLike<{ 0: { transcript: string } }> };
type Recognition = { continuous: boolean; interimResults: boolean; lang: string; onresult: ((e: RecognitionEvent) => void) | null; onerror: ((e: { error: string }) => void) | null; onend: (() => void) | null; start: () => void; stop: () => void };
type RecognitionConstructor = new () => Recognition;
function recognitionApi(): RecognitionConstructor | undefined {
  const w = window as unknown as { SpeechRecognition?: RecognitionConstructor; webkitSpeechRecognition?: RecognitionConstructor };
  return w.SpeechRecognition || w.webkitSpeechRecognition;
}

type Props = {
  recording: boolean;
  disabled?: boolean;
  onStart: () => void;
  onLive: (text: string) => void;
  onLiveEnd: () => void;
  onRecorded: (blob: Blob) => void;
  onError: (message: string) => void;
};

/**
 * Icon-only microphone toggle. Where the browser supports speech recognition the words appear live while
 * you talk; otherwise (or if live recognition fails) audio is recorded and transcribed by the server after you stop.
 */
export function MicButton({ recording, disabled, onStart, onLive, onLiveEnd, onRecorded, onError }: Props) {
  const recorder = useRef<MediaRecorder | null>(null);
  const recognition = useRef<Recognition | null>(null);
  const liveBroken = useRef(false);
  const wanted = useRef(false);

  function startLive(Api: RecognitionConstructor) {
    const engine = new Api();
    engine.continuous = true;
    engine.interimResults = true;
    engine.lang = navigator.language || 'en-GB';
    wanted.current = true;
    let earlier = '';   // text from sessions the engine already ended (it stops itself after a pause)
    let session = '';   // text from the session that is running now
    let failed = '';
    const join = (a: string, b: string) => [a, b].filter(Boolean).join(' ');
    engine.onresult = event => { session = collectTranscript(event.results); onLive(join(earlier, session)); };
    engine.onerror = event => {
      if (event.error === 'no-speech' || event.error === 'aborted') return;
      wanted.current = false;
      failed = event.error;
    };
    engine.onend = () => {
      if (wanted.current) {
        earlier = join(earlier, session); session = '';
        try { engine.start(); return; } catch { wanted.current = false; }
      }
      recognition.current = null;
      onLiveEnd();
      if (failed === 'not-allowed' || failed === 'service-not-allowed') onError(blocked);
      else if (failed) { liveBroken.current = true; onError('Live dictation stopped working. Press the microphone to try again; it will record and transcribe after you stop.'); }
    };
    recognition.current = engine;
    try { engine.start(); onStart(); window.setTimeout(() => { if (wanted.current) { wanted.current = false; engine.stop(); } }, 5 * 60 * 1000); }
    catch { recognition.current = null; wanted.current = false; liveBroken.current = true; void startRecorder(); }
  }

  async function startRecorder() {
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') { onError(unavailable); return; }
    let audio: MediaStream | null = null;
    try {
      audio = await navigator.mediaDevices.getUserMedia({ audio: true });
      const preferred = ['audio/webm', 'audio/mp4'].find(type => MediaRecorder.isTypeSupported(type));
      if (!preferred) { audio.getTracks().forEach(track => track.stop()); onError(unavailable); return; }
      const chunks: BlobPart[] = [];
      const media = new MediaRecorder(audio, { mimeType: preferred });
      const tracks = audio.getTracks();
      media.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
      media.onstop = () => { tracks.forEach(track => track.stop()); recorder.current = null; onRecorded(new Blob(chunks, { type: media.mimeType })); };
      recorder.current = media; media.start(); onStart();
      window.setTimeout(() => { if (media.state === 'recording') media.stop(); }, 5 * 60 * 1000);
    } catch (error) {
      audio?.getTracks().forEach(track => track.stop());
      const name = (error as { name?: string }).name;
      onError(name === 'NotAllowedError' || name === 'SecurityError' ? blocked : 'Recording could not start. Check your microphone and try again, or type your instruction.');
    }
  }

  function toggle() {
    if (recording) { wanted.current = false; recognition.current?.stop(); recorder.current?.stop(); return; }
    const Api = recognitionApi();
    if (Api && !liveBroken.current) startLive(Api); else void startRecorder();
  }

  return <button type="button" className={`icon-button mic${recording ? ' recording' : ''}`} disabled={disabled} aria-label={recording ? 'Stop dictation' : 'Start dictation'} aria-pressed={recording} title={recording ? 'Stop dictation' : 'Dictate'} onClick={toggle}>{recording ? <StopIcon /> : <MicIcon />}</button>;
}
