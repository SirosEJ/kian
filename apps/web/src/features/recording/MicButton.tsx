import { useRef } from 'react';

const unavailable = 'Voice recording is unavailable in this browser. Type your instruction instead.';

export function MicIcon() {
  return <svg aria-hidden="true" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3" /></svg>;
}
export function StopIcon() {
  return <svg aria-hidden="true" viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2" /></svg>;
}

type Props = { recording: boolean; disabled?: boolean; onStart: () => void; onRecorded: (blob: Blob) => void; onError: (message: string) => void };

/** Icon-only microphone toggle: records until pressed again (or five minutes), then hands the audio back. */
export function MicButton({ recording, disabled, onStart, onRecorded, onError }: Props) {
  const recorder = useRef<MediaRecorder | null>(null);

  async function start() {
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
      const denied = (error as { name?: string }).name === 'NotAllowedError' || (error as { name?: string }).name === 'SecurityError';
      onError(denied ? 'Microphone access is blocked. Allow the microphone for this site in your browser settings, then try again.' : 'Recording could not start. Check your microphone and try again, or type your instruction.');
    }
  }

  return <button type="button" className={`icon-button mic${recording ? ' recording' : ''}`} disabled={disabled} aria-label={recording ? 'Stop dictation' : 'Start dictation'} aria-pressed={recording} title={recording ? 'Stop dictation' : 'Dictate'} onClick={() => recording ? recorder.current?.stop() : void start()}>{recording ? <StopIcon /> : <MicIcon />}</button>;
}
