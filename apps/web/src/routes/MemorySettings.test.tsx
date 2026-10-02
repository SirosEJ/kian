import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { describeEntry, groupMemory, MemorySettings, type MemoryItem } from './MemorySettings.js';
import { activityTitle, eventLabel } from '../features/trust/wording.js';

const item = (over: Partial<MemoryItem>): MemoryItem => ({ id: 'i', kind: 'person', value: 'Solmaz Yilmaz', alias: 'Sol', detail: 'Jira', source: 'jira', ...over });

describe('What Kian remembers', () => {
  it('groups entries by kind in a fixed order and describes where each came from', () => {
    const groups = groupMemory([item({ id: 'c', kind: 'correction', value: 'Siros', alias: 'Seros', detail: null, source: 'chat' }), item({ id: 'e', kind: 'epic', value: 'Onboarding', alias: null, detail: 'SFT-267' }), item({ id: 'p' })]);
    expect(groups.map(g => g.name)).toEqual(['People', 'Epics', 'Spoken corrections']);
    expect(describeEntry(item({}))).toBe('also "Sol" · Jira · from Jira');
    expect(describeEntry(item({ kind: 'correction', value: 'Siros', alias: 'Seros', detail: null, source: 'chat' }))).toBe('you say "Seros" · from what you told Kian');
    expect(describeEntry(item({ alias: null, detail: null, source: 'manual' }))).toBe('added by you');
  });

  it('shows the entries with Edit and Delete, the learning switch, and the privacy promise', () => {
    const html = renderToStaticMarkup(<MemorySettings initial={{ enabled: true, terms: [item({})] }} />);
    expect(html).toContain('What Kian remembers');
    expect(html).toContain('Solmaz Yilmaz');
    expect(html).toContain('Edit');
    expect(html).toContain('Delete</button>');
    expect(html).toContain('Let Kian learn and use what it remembers');
    expect(html).toContain('deleted with your account');
    expect(html).toContain('Delete everything Kian remembers');
    expect(html).not.toContain('Learning is off');
  });

  it('says plainly when learning is off or nothing is remembered yet', () => {
    const off = renderToStaticMarkup(<MemorySettings initial={{ enabled: false, terms: [] }} />);
    expect(off).toContain('Learning is off');
    expect(off).toContain('Nothing yet');
    expect(off).not.toContain('Delete everything Kian remembers');
  });

  it('names the activity entry without any of the names', () => {
    expect(activityTitle(null, null, 'memory.learned')).toBe('Kian learned');
    expect(eventLabel('memory.learned')).toMatch(/Settings/);
  });
});
