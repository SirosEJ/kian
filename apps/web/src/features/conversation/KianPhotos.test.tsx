import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { KianPhotos } from './KianPhotos.js';
import { Thread } from './Thread.js';

describe('Kian\'s photos in the conversation', () => {
  it('shows a labelled gallery with one placeholder per photo until each one has loaded', () => {
    const html = renderToStaticMarkup(<KianPhotos ids={['kian-1', 'kian-2', 'kian-3']} load={async () => new Blob()} />);
    expect(html).toContain('role="group"');
    expect(html).toContain('aria-label="Photos of Kian"');
    expect((html.match(/kian-photo-loading/g) ?? []).length).toBe(3);
    expect(html).not.toContain('<img');
  });

  it('appears under Kian\'s reply, and only when the message carries photos', () => {
    const withPhotos = renderToStaticMarkup(<Thread messages={[{ id: '1', role: 'user', content: 'show me your photo' }, { id: '2', role: 'assistant', content: 'Here I am!', photos: ['kian-1', 'kian-2'] }]} />);
    expect(withPhotos).toContain('Here I am!');
    expect(withPhotos.indexOf('Here I am!')).toBeLessThan(withPhotos.indexOf('Photos of Kian'));
    const without = renderToStaticMarkup(<Thread messages={[{ id: '2', role: 'assistant', content: 'Hello', photos: [] }, { id: '3', role: 'assistant', content: 'Hi' }]} />);
    expect(without).not.toContain('Photos of Kian');
  });
});
