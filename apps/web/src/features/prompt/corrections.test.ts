import { describe, expect, it } from 'vitest';
import { applyCorrections } from './corrections.js';

describe('dictation corrections in the browser', () => {
  it('replaces whole words only, in any case, using the user\'s own spelling', () => {
    expect(applyCorrections('Hello Seros, seros and Serosa', [{ from: 'Seros', to: 'Siros' }])).toBe('Hello Siros, Siros and Serosa');
    expect(applyCorrections('ask sol man', [{ from: 'Sol man', to: 'Solmaz' }])).toBe('ask Solmaz');
  });
  it('ignores very short spoken forms and empty replacements, and does nothing without corrections', () => {
    expect(applyCorrections('no way', [{ from: 'no', to: 'yes' }, { from: 'way', to: '' }])).toBe('no way');
    expect(applyCorrections('same', [])).toBe('same');
  });
});
