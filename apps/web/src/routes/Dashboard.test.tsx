import { describe, expect, it } from 'vitest';
import { renderToString } from 'react-dom/server';
import { Dashboard } from './Dashboard.js';

describe('Dashboard', () => {
  it('offers one AI-style prompt with microphone dictation and a send button', () => {
    const html = renderToString(<Dashboard />);
    expect(html).toContain('aria-label="Type an instruction"');
    expect(html).toContain('aria-label="Start dictation"');
    expect(html).toContain('aria-label="Send instruction"');
    expect(html).not.toContain('Record voice');
    expect(html).not.toContain('Review tasks');
  });

  it('starts with send disabled until there is text', () => {
    expect(renderToString(<Dashboard />)).toMatch(/aria-label="Send instruction"[^>]*disabled|disabled=""[^>]*aria-label="Send instruction"/);
  });
});
