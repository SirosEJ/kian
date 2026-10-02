import { safetyChecks } from '../features/trust/wording.js';

export type ReviewData = { matched: string; changes: { field: string; before: string; after: string }[] };

/** Reads the review the server attached to a card, ignoring anything that is not in the expected shape. */
export function reviewOf(parameters?: Record<string, unknown>): ReviewData | null {
  const raw = parameters?._review as Partial<ReviewData> | undefined;
  if (!raw || typeof raw.matched !== 'string' || !Array.isArray(raw.changes)) return null;
  const changes = raw.changes.filter(c => c && typeof c.field === 'string' && typeof c.before === 'string' && typeof c.after === 'string').slice(0, 20);
  return { matched: raw.matched, changes };
}

/** What will change (now and after), how Kian matched the request to this exact item, and the safety checks that were made. */
export function ReviewPanel({ action, parameters }: { action: string; parameters?: Record<string, unknown> }) {
  const review = reviewOf(parameters);
  return <div className="review">
    {review && review.changes.length > 0 && <figure className="result">
      <figcaption>What will change</figcaption>
      <div className="table-scroll" tabIndex={0} role="region" aria-label="What will change">
        <table><thead><tr><th scope="col">Field</th><th scope="col">Now</th><th scope="col">After you approve</th></tr></thead>
          <tbody>{review.changes.map(c => <tr key={c.field}><td>{c.field}</td><td>{c.before}</td><td><strong>{c.after}</strong></td></tr>)}</tbody></table>
      </div>
    </figure>}
    {review && <p className="muted"><strong>How Kian matched this:</strong> {review.matched}</p>}
    <details><summary>Safety checks</summary><ul className="list">{safetyChecks(action).map(c => <li key={c}>{c}</li>)}</ul></details>
  </div>;
}
