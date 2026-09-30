import { useRef, useState } from 'react';

export function Recorder({ onRecorded }: { onRecorded: (blob: Blob) => Promise<void> }) {
  const recorder = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const [recording, setRecording] = useState(false);
  const [error, setError] = useState('');

  async function start() {
    setError('');
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') { setError('Voice recording is unavailable in this browser. Type your instruction instead.'); return; }
    try {
      const audio = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.current = audio;
      const chunks: BlobPart[] = [];
      const preferred = ['audio/webm', 'audio/mp4'].find(type => MediaRecorder.isTypeSupported(type));
      if (!preferred) { audio.getTracks().forEach(track => track.stop()); setError('Voice recording is unavailable in this browser. Type your instruction instead.'); return; }
      const media = new MediaRecorder(audio, { mimeType: preferred });
      media.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
      media.onstop = () => {
        audio.getTracks().forEach(track => track.stop()); stream.current = null; setRecording(false);
        void onRecorded(new Blob(chunks, { type: media.mimeType })).catch(() => setError('Transcription failed. Please retry or type the instruction.'));
      };
      recorder.current = media; media.start(); setRecording(true);
      window.setTimeout(() => { if (media.state === 'recording') media.stop(); }, 5 * 60 * 1000);
    } catch { stream.current?.getTracks().forEach(track => track.stop()); stream.current = null; setError('Microphone access was denied or recording could not start. Type your instruction instead.'); }
  }

  return <div><button type="button" onClick={() => recording ? recorder.current?.stop() : void start()}>{recording ? 'Stop recording' : 'Record voice'}</button>{error && <p role="alert">{error}</p>}</div>;
}
