import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Thread } from './Thread.js';
import { EXAMPLES, Welcome } from './Welcome.js';
import { HistoryMenu } from './HistoryMenu.js';
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

describe('chat screen pieces', () => {
  it('puts each task card under the reply that prepared it, not at the end of the chat', () => {
    const messages = [
      { id: '1', role: 'user' as const, content: 'Meeting with Sam' },
      { id: '2', role: 'assistant' as const, content: 'Prepared.', tasks: [{ id: 't1' }, { id: 't2' }] },
      { id: '3', role: 'user' as const, content: 'Thanks' },
      { id: '4', role: 'assistant' as const, content: 'You are welcome.', tasks: [] },
    ];
    const html = renderToStaticMarkup(<Thread messages={messages} renderTask={task => <b>{`card ${task.id}`}</b>} />);
    expect(html.indexOf('Prepared.')).toBeLessThan(html.indexOf('card t1'));
    expect(html.indexOf('card t2')).toBeLessThan(html.indexOf('Thanks'));
    expect(html.match(/card t/g)).toHaveLength(2);
  });

  it('shows Kian thinking inside the chat while waiting, even before the first reply', () => {
    const html = renderToStaticMarkup(<Thread messages={[{ id: '1', role: 'user', content: 'Hi' }]} thinking />);
    expect(html).toContain('aria-label="Kian is thinking"');
    expect(html.indexOf('Hi')).toBeLessThan(html.indexOf('Kian is thinking'));
    expect(renderToStaticMarkup(<Thread messages={[]} />)).toBe('');
  });

  it('offers example prompts on the empty chat, each tappable', () => {
    const html = renderToStaticMarkup(<Welcome onPick={() => {}} />);
    for (const example of EXAMPLES) expect(html).toContain(example.replaceAll("'", '&#x27;'));
    expect(EXAMPLES.length).toBeGreaterThanOrEqual(3);
    expect(html.match(/<button/g)).toHaveLength(EXAMPLES.length);
    expect(renderToStaticMarkup(<Welcome onPick={() => {}} disabled />).match(/disabled/g)).toHaveLength(EXAMPLES.length);
  });

  it('lists earlier conversations and marks the open one', () => {
    const html = renderToStaticMarkup(<HistoryMenu conversations={[{ id: 'a', createdAt: '2026-10-01T10:00:00Z', title: 'Book a meeting' }, { id: 'b', createdAt: '2026-09-30T10:00:00Z', title: 'Email Sam' }]} currentId="b" onPick={() => {}} />);
    expect(html).toContain('Book a meeting');
    expect(html.match(/aria-current="true"/g)).toHaveLength(1);
    expect(renderToStaticMarkup(<HistoryMenu conversations={[]} currentId={null} onPick={() => {}} />)).toContain('No earlier conversations');
  });
});
