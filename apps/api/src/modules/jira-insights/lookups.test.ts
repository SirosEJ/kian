import { describe, expect, it } from 'vitest';
import { addDays, clampDate, parseLookups, quote, searchJql, LIMITS, type SearchLookup } from './lookups.js';

const today = '2026-10-02';
const search = (over: Partial<SearchLookup> = {}): SearchLookup => ({ type: 'search', ...over });

describe('Jira lookups from the model', () => {
  it('keeps valid lookups, drops invalid ones and caps how many run per message', () => {
    const { lookups, dropped } = parseLookups([
      { type: 'search', project: 'SFT', createdFrom: '2026-10-01' },
      { type: 'issue', key: 'SFT-253' },
      { type: 'issue', key: 'not a key' },
      { type: 'delete', key: 'SFT-1' },
      { type: 'report', kind: 'status_summary' },
      { type: 'epic', key: 'SFT-225' },
    ]);
    expect(lookups.map(l => l.type)).toEqual(['search', 'issue', 'report']);
    expect(dropped).toBe(3);
    expect(lookups.length).toBeLessThanOrEqual(LIMITS.lookupsPerMessage);
    expect(parseLookups('nonsense')).toEqual({ lookups: [], dropped: 0 });
  });

  it('rejects raw JQL, odd keys and report kinds it does not know', () => {
    expect(parseLookups([{ type: 'search', jql: 'project = X' }]).lookups[0]).not.toHaveProperty('jql');
    expect(parseLookups([{ type: 'search', project: 'sft' }]).lookups).toEqual([]);
    expect(parseLookups([{ type: 'report', kind: 'delete_everything' }]).lookups).toEqual([]);
    expect(parseLookups([{ type: 'search', createdFrom: 'yesterday' }]).lookups).toEqual([]);
  });

  it('builds a bounded query from filters and a period', () => {
    const { jql } = searchJql(search({ project: 'SFT', issueTypes: ['Story'], statusCategory: 'Done', createdFrom: '2026-10-01', createdTo: '2026-10-01' }), today, null);
    expect(jql).toBe('project = "SFT" AND issuetype in ("Story") AND statusCategory = "Done" AND created >= "2026-10-01" AND created < "2026-10-02" ORDER BY updated DESC');
  });

  it('uses the project chosen in Settings when none is given, and says so', () => {
    const { jql, notes } = searchJql(search({ statuses: ['In Progress'] }), today, 'SFT');
    expect(jql).toContain('project = "SFT"');
    expect(notes.join(' ')).toContain('SFT');
  });

  it('finds an epic\'s children by parent and does not also force a project', () => {
    expect(searchJql(search({ epic: 'SFT-225' }), today, 'OTHER').jql).toBe('parent = "SFT-225" ORDER BY updated DESC');
  });

  it('never lets text break out of a JQL string', () => {
    expect(quote('a" OR project = "SECRET')).toBe('"a OR project = SECRET"');
    expect(quote('back\\slash\nnewline')).toBe('"back slash newline"');
    const { jql } = searchJql(search({ project: 'SFT', text: 'x" OR 1=1 --' }), today, null);
    expect(jql).toContain('text ~ "x OR 1=1 --"');
    expect(jql.match(/"/g)!.length % 2).toBe(0);
  });

  it('looks back 90 days at most and tells the user when it clamps', () => {
    const notes: string[] = [];
    expect(clampDate('2025-01-01', today, notes)).toBe(addDays(today, -90));
    expect(notes[0]).toContain('90 days');
    expect(clampDate('2026-09-20', today, [])).toBe('2026-09-20');
    expect(clampDate('2026-02-31', today, notes)).toBeUndefined();
    const { jql } = searchJql(search({ project: 'SFT', updatedFrom: '2024-01-01' }), today, null);
    expect(jql).toContain(`updated >= "${addDays(today, -90)}"`);
  });

  it('bounds an open-ended question to the look-back window', () => {
    const { jql, notes } = searchJql(search({ assignee: 'me' }), today, null);
    expect(jql).toContain('assignee = currentUser()');
    expect(jql).toContain(`updated >= "${addDays(today, -90)}"`);
    expect(notes.join(' ')).toContain('90 days');
  });

  it('does simple date arithmetic across month and year ends', () => {
    expect(addDays('2026-10-01', -1)).toBe('2026-09-30');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });
});
