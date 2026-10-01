import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Thread } from './Thread.js';
import { eventLabel } from '../trust/wording.js';

describe('conversation thread', () => {
  it('shows nothing before the first message', () => {
    expect(renderToStaticMarkup(<Thread messages={[]} />)).toBe('');
  });

  it('shows the user\'s words and Kian\'s replies in order, each labelled', () => {
    const html = renderToStaticMarkup(<Thread messages={[{ id: '1', role: 'user', content: 'Plan a meeting' }, { id: '2', role: 'assistant', content: 'What day and time?' }, { id: '3', role: 'user', content: 'Friday at 3pm' }]} />);
    expect(html).toContain('role="log"');
    expect(html.indexOf('Plan a meeting')).toBeLessThan(html.indexOf('What day and time?'));
    expect(html.indexOf('What day and time?')).toBeLessThan(html.indexOf('Friday at 3pm'));
    expect(html.match(/aria-label="Your message"/g)).toHaveLength(2);
    expect(html.match(/aria-label="Kian&#x27;s reply"/g)).toHaveLength(1);
  });

  it('renders message text as text, never as markup', () => {
    const html = renderToStaticMarkup(<Thread messages={[{ id: '1', role: 'user', content: '<img src=x onerror=alert(1)>' }]} />);
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img');
  });

  it('explains in Activity that a replaced proposal was never approved or run', () => {
    expect(eventLabel('task.replaced')).toMatch(/never approved or run/);
  });
});
