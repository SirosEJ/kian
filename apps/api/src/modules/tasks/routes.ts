import type { FastifyInstance } from 'fastify';
import type { TaskProposal } from '@kian/contracts';
import type { PlanResult } from './plan.js';
import OpenAI, { toFile } from 'openai';
import { applyCorrections, type Correction } from '../memory/dictation.js';
import { ConversationError, type Converse, type ConversationSummary, type StoredMessage } from '../conversations/service.js';

export type TaskRoutes = {
  authenticate: (request: { headers: { authorization?: string } }) => Promise<string>;
  plan: (ownerId: string, text: string, locale: string, timeZone: string) => Promise<Omit<PlanResult, 'pending'> & Partial<Pick<PlanResult, 'pending'>>>;
  save: (ownerId: string, text: string, tasks: TaskProposal[]) => Promise<TaskProposal[] | void>;
  /** When set, messages are part of a saved conversation (plan and save are then handled by it). */
  converse?: Converse;
  conversations?: { latest: (ownerId: string) => Promise<{ conversationId: string | null; messages: StoredMessage[] }>; get?: (ownerId: string, id: string) => Promise<{ conversationId: string; messages: StoredMessage[] }>; list?: (ownerId: string) => Promise<ConversationSummary[]>; create: (ownerId: string) => Promise<string> };
  transcribe?: (audio: Buffer, mimeType: string, prompt?: string) => Promise<string>;
  /** The user's dictation help (SFT-281): a vocabulary prompt for the transcription model and spoken-form corrections to apply to its text. */
  dictation?: (ownerId: string) => Promise<{ prompt: string; corrections: Correction[] }>;
};

async function defaultTranscribe(audio: Buffer, mimeType: string, prompt?: string): Promise<string> {
  if (!process.env.OPENAI_API_KEY) throw new Error('Transcription is not configured');
  const file = await toFile(audio, mimeType === 'audio/mp4' ? 'recording.mp4' : 'recording.webm', { type: mimeType });
  const result = await new OpenAI({ apiKey: process.env.OPENAI_API_KEY }).audio.transcriptions.create({ model: 'gpt-4o-transcribe', file, ...(prompt ? { prompt } : {}) });
  return result.text;
}

export function registerTaskRoutes(app: FastifyInstance, deps: TaskRoutes) {
  app.post<{Body:{text?:string;locale?:string;timeZone?:string;conversationId?:unknown}}>('/instructions', async (request, reply) => {
    const ownerId = await deps.authenticate(request);
    const text = request.body?.text?.trim();
    if (!text || text.length > 10000) return reply.code(400).send({ error: 'Instruction text must be 1–10000 characters' });
    const locale = request.body.locale || 'en-GB', timeZone = request.body.timeZone || 'UTC';
    if (deps.converse) {
      const conversationId = request.body.conversationId;
      if (conversationId !== undefined && typeof conversationId !== 'string') return reply.code(400).send({ error: 'Invalid conversation' });
      try { return reply.code(201).send(await deps.converse(ownerId, { text, conversationId, locale, timeZone })); }
      catch (error) { if (error instanceof ConversationError) return reply.code(error.statusCode).send({ error: error.message }); throw error; }
    }
    const { reply: assistantReply, tasks } = await deps.plan(ownerId, text, locale, timeZone);
    const saved = await deps.save(ownerId, text, tasks);
    return reply.code(201).send({ reply: assistantReply, tasks: saved || tasks });
  });

  app.get('/conversations/latest', async (request, reply) => {
    const ownerId = await deps.authenticate(request);
    if (!deps.conversations) return reply.code(404).send({ error: 'Conversations unavailable' });
    return deps.conversations.latest(ownerId);
  });
  app.get('/conversations', async (request, reply) => {
    const ownerId = await deps.authenticate(request);
    if (!deps.conversations?.list) return reply.code(404).send({ error: 'Conversations unavailable' });
    return deps.conversations.list(ownerId);
  });
  app.get<{ Params: { id: string } }>('/conversations/:id', async (request, reply) => {
    const ownerId = await deps.authenticate(request);
    if (!deps.conversations?.get) return reply.code(404).send({ error: 'Conversations unavailable' });
    try { return await deps.conversations.get(ownerId, request.params.id); }
    catch (error) { if (error instanceof ConversationError) return reply.code(error.statusCode).send({ error: error.message }); throw error; }
  });
  app.post('/conversations', async (request, reply) => {
    const ownerId = await deps.authenticate(request);
    if (!deps.conversations) return reply.code(404).send({ error: 'Conversations unavailable' });
    return reply.code(201).send({ conversationId: await deps.conversations.create(ownerId) });
  });

  app.post<{Body:{audioBase64?:string;mimeType?:string}}>('/transcriptions', { bodyLimit: 16 * 1024 * 1024 }, async (request, reply) => {
    const ownerId = await deps.authenticate(request);
    const { audioBase64 } = request.body || {};
    // Browsers label recordings like "audio/webm;codecs=opus"; only the base type matters.
    const mimeType = (request.body?.mimeType || '').split(';')[0].trim().toLowerCase();
    if (!audioBase64 || !/^[A-Za-z0-9+/]+={0,2}$/.test(audioBase64) || !['audio/webm','audio/mp4'].includes(mimeType)) return reply.code(400).send({ error: 'Supported audio recording required' });
    if (audioBase64.length > Math.ceil(10 * 1024 * 1024 * 4 / 3)) return reply.code(413).send({ error: 'Recording exceeds 10 MB' });
    // The user's own names help the transcription model, and words they have corrected before come out in their spelling. Failing to load either never blocks dictation.
    const help = await deps.dictation?.(ownerId).catch(() => null);
    try {
      const text = await (deps.transcribe || defaultTranscribe)(Buffer.from(audioBase64, 'base64'), mimeType, help?.prompt || undefined);
      return { text: help ? applyCorrections(text, help.corrections) : text };
    }
    catch { return reply.code(502).send({ error: 'Transcription failed. Please retry or type the instruction.' }); }
  });
}
