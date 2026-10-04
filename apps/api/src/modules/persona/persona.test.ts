import { describe, expect, it } from 'vitest';
import Fastify from 'fastify';
import { existsSync, readFileSync } from 'node:fs';
import { personaReply, PERSONA_INTRO, PERSONA_PHOTOS, PHOTO_IDS, validPhoto, isPhotos } from './persona.js';
import { registerPersonaRoutes } from './routes.js';

describe('Kian talking about himself', () => {
  it('answers questions about Kian with the introduction, without photos', () => {
    for (const q of ['who are you Kian?', 'Who are you', 'who r u', 'who is Kian?', 'what are you?', "what's your name", 'what is your name?', 'tell me about yourself', 'tell me about Kian', 'introduce yourself', 'who made you?', 'who created Kian', 'who built this app?', 'who is your dad?', "who's your father", 'how old are you?', 'Hello Kian, who are you?']) {
      expect(personaReply(q), q).toEqual({ reply: PERSONA_INTRO, photos: [] });
    }
    expect(PERSONA_INTRO).toBe("I am a cute kid, only 8 years old, and my dad created this app. My dad's name is Siros. Do you want to see my photo?");
  });

  it('shows the photos when asked, or when the user says yes right after Kian offered', () => {
    for (const q of ['show me your photo', 'Show me your foto', 'can I see your picture?', 'send me your selfie', 'let me see your photos', 'your photo please', 'what do you look like?']) {
      expect(personaReply(q), q).toEqual({ reply: PERSONA_PHOTOS, photos: [...PHOTO_IDS] });
    }
    for (const yes of ['yes', 'Yes!', 'yeah', 'sure', 'ok', 'okay', 'please', 'show me', 'of course', 'Yes please', 'evet']) {
      expect(personaReply(yes, PERSONA_INTRO), yes).toEqual({ reply: PERSONA_PHOTOS, photos: [...PHOTO_IDS] });
    }
  });

  it('does not treat "yes" as a photo request unless Kian just made the offer', () => {
    expect(personaReply('yes')).toBeNull();
    expect(personaReply('yes', 'Here are your stories.')).toBeNull();
    expect(personaReply('yes', PERSONA_PHOTOS)).toBeNull();
    expect(personaReply('no thanks', PERSONA_INTRO)).toBeNull();
    expect(personaReply('yes move them to Done', PERSONA_INTRO)).toBeNull();
  });

  it('leaves ordinary requests alone, including questions that only look similar', () => {
    for (const q of ['who created them?', 'who created these issues', 'who is assigned to SFT-12?', 'show me the stories in To Do', 'what is on my calendar tomorrow?', 'who are my meetings with', 'how old is SFT-12', 'create a story about photos', 'attach the photo to the issue', 'move all the deployed ones into done', 'what is the status of SFT-253?', '', '   ', 'x'.repeat(300)]) {
      expect(personaReply(q), q).toBeNull();
    }
  });

  it('has eight photo ids, all valid, and recognises the stored attachment', () => {
    expect(PHOTO_IDS).toHaveLength(8);
    expect(PHOTO_IDS.every(validPhoto)).toBe(true);
    expect(validPhoto('../secret')).toBe(false);
    expect(isPhotos({ kind: 'photos', ids: ['kian-1'] })).toBe(true);
    expect(isPhotos({ title: 'Issues', rows: [] })).toBe(false);
    expect(isPhotos(null)).toBe(false);
  });
});

describe('the photo files and route', () => {
  const dir = new URL('../../../assets/persona/', import.meta.url);

  it('ships all eight photos as plain JPEGs with no metadata (no location or camera details)', () => {
    for (const id of PHOTO_IDS) {
      const file = new URL(`${id}.jpg`, dir);
      expect(existsSync(file), id).toBe(true);
      const bytes = readFileSync(file);
      expect(bytes.subarray(0, 2).toString('hex')).toBe('ffd8');
      expect(bytes.length).toBeLessThan(400_000);
      // An EXIF block starts with "Exif\0\0" inside an APP1 marker; a GPS block would sit inside it.
      expect(bytes.subarray(0, 4096).includes(Buffer.from('Exif\0\0', 'latin1')), `${id} has EXIF`).toBe(false);
      expect(bytes.includes(Buffer.from('GPS', 'latin1')), `${id} mentions GPS`).toBe(false);
    }
  });

  it('serves a photo only to a signed-in user, and only the known ones', async () => {
    const app = Fastify();
    registerPersonaRoutes(app, async request => { if (!request.headers.authorization) throw Object.assign(new Error('Sign in'), { statusCode: 401 }); return 'alice'; });
    const signedOut = await app.inject({ method: 'GET', url: '/persona/photos/kian-1' });
    expect(signedOut.statusCode).toBe(401);
    const ok = await app.inject({ method: 'GET', url: '/persona/photos/kian-1', headers: { authorization: 'Bearer t' } });
    expect(ok.statusCode).toBe(200);
    expect(ok.headers['content-type']).toBe('image/jpeg');
    expect(ok.headers['cache-control']).toBe('private, max-age=86400');
    expect(ok.rawPayload.subarray(0, 2).toString('hex')).toBe('ffd8');
    for (const id of ['kian-9', 'nope', '..%2F..%2Fpackage', 'kian-1.jpg']) expect((await app.inject({ method: 'GET', url: `/persona/photos/${id}`, headers: { authorization: 'Bearer t' } })).statusCode, id).toBe(404);
    await app.close();
  });

  it('says not found when a listed photo file is missing', async () => {
    const app = Fastify();
    registerPersonaRoutes(app, async () => 'alice', new URL('file:///nonexistent/dir/'));
    expect((await app.inject({ method: 'GET', url: '/persona/photos/kian-1' })).statusCode).toBe(404);
    await app.close();
  });
});
