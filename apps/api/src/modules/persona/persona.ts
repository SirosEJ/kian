/**
 * Kian talking about himself. The answer is fixed text, chosen by rules and not by the model, so the wording never drifts and a
 * question about Kian costs nothing. It creates no tasks and reads nothing from Jira or Google.
 */
export const PERSONA_INTRO = "I am a cute kid, only 8 years old, and my dad created this app. My dad's name is Siros. Do you want to see my photo?";
export const PERSONA_PHOTOS = 'Here I am! Some of the photos are with my dad.';
export const PHOTO_IDS = ['kian-1', 'kian-2', 'kian-3', 'kian-4', 'kian-5', 'kian-6', 'kian-7', 'kian-8'] as const;
export type PhotoId = (typeof PHOTO_IDS)[number];
export type PersonaReply = { reply: string; photos: PhotoId[] };

// Questions about Kian himself. "who created them?" (about Jira results) must never match: the words are always you / your / Kian.
const ABOUT = [
  /\bwho\s+(?:are|r)\s+(?:you|u)\b/i,
  /\bwho\s+is\s+kian\b/i,
  /\bwhat\s+(?:are|r)\s+you\b/i,
  /\bwhat(?:'s|\s+is)\s+(?:your\s+name|kian)\b/i,
  /\btell\s+me\s+(?:about|more\s+about)\s+(?:yourself|your\s*self|kian|you)\b/i,
  /\bintroduce\s+yourself\b/i,
  /\bwho\s+(?:made|created|built|developed|designed|owns)\s+(?:you|kian|this\s+app|this)\b/i,
  /\bwho(?:\s+is|'s|s)\s+your\s+(?:dad|father|daddy|creator|maker|owner)\b/i,
  /\bhow\s+old\s+(?:are\s+you|is\s+kian)\b/i,
  /\babout\s+kian\b.*\?/i,
];
// Asking to see Kian's photo.
const PHOTO = [
  /\b(?:show|see|send|share|give|let\s+me\s+see)\b[^.?!]*\b(?:your|kian'?s)\s+(?:photos?|fotos?|pictures?|pics?|selfies?|images?)\b/i,
  /\b(?:your|kian'?s)\s+(?:photos?|fotos?|pictures?|pics?|selfies?)\b/i,
  /\bwhat\s+do\s+you\s+look\s+like\b/i,
  /\bcan\s+i\s+see\s+(?:you|kian)\b/i,
];
const YES = /^\s*(?:yes|yeah|yep|yup|sure|ok(?:ay)?|please|show(?:\s+me)?|of\s+course|why\s+not|evet|oui|si|sí|ja|da)\b[\s.!,]*(?:please)?[\s.!]*$/i;

/** The persona answer for a message, or null when the message is an ordinary one. `lastAssistant` is Kian's previous reply in this conversation. */
export function personaReply(text: string, lastAssistant?: string | null): PersonaReply | null {
  const t = text.trim();
  if (!t || t.length > 200) return null;
  // "yes" only counts directly after Kian's own offer to show the photo.
  if (YES.test(t) && lastAssistant?.startsWith(PERSONA_INTRO)) return { reply: PERSONA_PHOTOS, photos: [...PHOTO_IDS] };
  if (PHOTO.some(r => r.test(t))) return { reply: PERSONA_PHOTOS, photos: [...PHOTO_IDS] };
  if (ABOUT.some(r => r.test(t))) return { reply: PERSONA_INTRO, photos: [] };
  return null;
}

/** What is stored with the message so the photos come back when the conversation is reopened. */
export type PhotosAttachment = { kind: 'photos'; ids: PhotoId[] };
export const isPhotos = (value: unknown): value is PhotosAttachment => Boolean(value) && typeof value === 'object' && (value as { kind?: unknown }).kind === 'photos' && Array.isArray((value as { ids?: unknown }).ids);
export const validPhoto = (id: string): id is PhotoId => (PHOTO_IDS as readonly string[]).includes(id);
