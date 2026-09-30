import { describe, expect, it } from 'vitest';
import { renderToString } from 'react-dom/server';
import { Dashboard } from './Dashboard.js';

describe('Dashboard', () => {
  it('offers typed instruction and voice recording with a review step', () => {
    const html = renderToString(<Dashboard />);
    expect(html).toContain('Type an instruction');
    expect(html).toContain('Record voice');
    expect(html).toContain('Review tasks');
  });
});
