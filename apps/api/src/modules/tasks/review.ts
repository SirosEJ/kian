/** One line of "what will change": the field, how it is now, and how it will be after approval. */
export type ReviewChange = { field: string; before: string; after: string };
/**
 * What the approval card shows besides the details: how Kian matched the request to this exact item (a rule, not a model
 * guess: Kian does not show a confidence number because it would not be reliable) and what will change. Built by the server
 * from what Jira or Google actually returned, never from the model's words.
 */
export type Review = { matched: string; changes: ReviewChange[] };
export const REVIEW_KEY = '_review';

export const short = (value: unknown, max = 120) => {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
};

/** Parameters with the review added (or replaced), leaving every other field as it was. */
export const withReview = (parameters: Record<string, unknown>, review: Review): Record<string, unknown> => ({ ...parameters, [REVIEW_KEY]: review });
