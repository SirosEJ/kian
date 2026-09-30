import type { FastifyInstance } from 'fastify';
import type { TaskProposal } from '@kian/contracts';
import OpenAI, { toFile } from 'openai';

export type TaskRoutes = {
  authenticate: (request: { headers: { authorization?: string } }) => Promise<string>;
  plan: (ownerId: string, text: string, locale: string, timeZone: string) => Promise<TaskProposal[]>;
  save: (ownerId: string, text: string, tasks: TaskProposal[]) => Promise<TaskProposal[] | void>;
  transcribe?: (audio: Buffer, mimeType: string) => Promise<string>;
};

async function defaultTranscribe(audio: Buffer, mimeType: string): Promise<string> {
  if (!process.env.OPENAI_API_KEY) throw new Error('Transcription is not configured');
  const file = await toFile(audio, mimeType === 'audio/mp4' ? 'recording.mp4' : 'recording.webm', { type: mimeType });
  const result = await new OpenAI({ apiKey: process.env.OPENAI_API_KEY }).audio.transcriptions.create({ model: 'gpt-4o-transcribe', file });
  return result.text;
}

export function registerTaskRoutes(app: FastifyInstance, deps: TaskRoutes) {
  app.post<{Body:{text?:string;locale?:string;timeZone?:string}}>('/instructions', async (request, reply) => {
    const ownerId = await deps.authenticate(request);
    const text = request.body?.text?.trim();
    if (!text || text.length > 10000) return reply.code(400).send({ error: 'Instruction text must be 1–10000 characters' });
    const tasks = await deps.plan(ownerId, text, request.body.locale || 'en-GB', request.body.timeZone || 'UTC');
    const saved = await deps.save(ownerId, text, tasks);
    return reply.code(201).send({ tasks: saved || tasks });
  });

  app.post<{Body:{audioBase64?:string;mimeType?:string}}>('/transcriptions', { bodyLimit: 16 * 1024 * 1024 }, async (request, reply) => {
    await deps.authenticate(request);
    const { audioBase64, mimeType } = request.body || {};
    if (!audioBase64 || !/^[A-Za-z0-9+/]+={0,2}$/.test(audioBase64) || !['audio/webm','audio/mp4'].includes(mimeType || '')) return reply.code(400).send({ error: 'Supported audio recording required' });
    if (audioBase64.length > Math.ceil(10 * 1024 * 1024 * 4 / 3)) return reply.code(413).send({ error: 'Recording exceeds 10 MB' });
    try { return { text: await (deps.transcribe || defaultTranscribe)(Buffer.from(audioBase64, 'base64'), mimeType!) }; }
    catch { return reply.code(502).send({ error: 'Transcription failed. Please retry or type the instruction.' }); }
  });
}
