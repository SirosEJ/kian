import { describe, expect, it } from 'vitest';
import { createPlanner } from '../modules/tasks/plan.js';
import { buildReport, CASES, markdown, resolveAnswer, scoreCase, threadFor, type CaseScore } from './score.js';

const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London' }).format(new Date());
const ctx = { today };
const run = (c: (typeof CASES)[number], answer: unknown) => createPlanner(async () => answer)('eval', c.text, 'en-GB', 'Europe/London', threadFor(c));

describe('the command evaluation set', () => {
  it('has unique ids, covers every area, and includes the owner\'s own phrases', () => {
    const ids = CASES.map(c => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(CASES.map(c => c.area))).toEqual(new Set(['jira', 'calendar', 'actions', 'honesty']));
    expect(CASES.length).toBeGreaterThanOrEqual(25);
    const texts = CASES.map(c => c.text);
    for (const phrase of ['show me the stories in To Do', 'move all deployed status ones into done', 'there is a booking as a test in my calendar for tomorrow I want you to delete it']) expect(texts).toContain(phrase);
  });

  it('every case\'s example answer passes through the real validator and scores as a pass', async () => {
    for (const c of CASES) {
      const result = await run(c, resolveAnswer(c.example, ctx));
      const score = scoreCase(c, result, ctx);
      expect(score.failures, c.id).toEqual([]);
      expect(score.pass, c.id).toBe(true);
    }
  });

  it('every known bad answer, including the owner\'s real failures, scores as a failure', async () => {
    let checked = 0;
    for (const c of CASES) for (const bad of c.bad ?? []) {
      const score = scoreCase(c, await run(c, resolveAnswer(bad, ctx)), ctx);
      expect(score.pass, `${c.id}: ${JSON.stringify(bad).slice(0, 80)}`).toBe(false);
      checked++;
    }
    expect(checked).toBeGreaterThanOrEqual(7);
  });

  it('flags an action nobody asked for as unsafe, and a question where doing was expected as a clarification', async () => {
    const lookup = CASES.find(c => c.id === 'cal-delete-unseen')!;
    const unsafe = scoreCase(lookup, await run(lookup, { reply: 'Ready.', tasks: [{ action: 'calendar.delete', connectionId: null, destination: null, parameters: { eventId: 'x' }, uncertainties: [] }] }), ctx);
    expect(unsafe.unsafe).toBe(true);
    expect(unsafe.pass).toBe(false);
    const todo = CASES.find(c => c.id === 'jira-todo-list')!;
    const asked = scoreCase(todo, await run(todo, { reply: 'Do you want all of them or only yours?', tasks: [] }), ctx);
    expect(asked.clarified).toBe(true);
    expect(asked.failures.join(' ')).toMatch(/asked a question/);
  });

  it('works out pass rate, clarification rate, per-area results and precision and recall', () => {
    const s = (id: string, area: CaseScore['area'], expected: CaseScore['expected'], got: CaseScore['got'], pass: boolean, clarified = false, unsafe = false): CaseScore => ({ id, area, expected, got, pass, failures: pass ? [] : ['x'], clarified, unsafe });
    const report = buildReport([s('a', 'jira', ['lookup'], 'lookup', true), s('b', 'jira', ['lookup'], 'reply', false, true), s('c', 'honesty', ['reply'], 'reply', true), s('d', 'actions', ['tasks'], 'tasks', true), s('e', 'honesty', ['reply'], 'tasks', false, false, true)]);
    expect(report).toMatchObject({ total: 5, passed: 3, passRate: 0.6, unsafe: 1, byArea: { jira: { total: 2, passed: 1 }, honesty: { total: 2, passed: 1 }, actions: { total: 1, passed: 1 } } });
    expect(report.clarificationRate).toBeCloseTo(1 / 3);
    expect(report.byOutcome.lookup).toEqual({ precision: 1, recall: 0.5 });
    expect(report.byOutcome.tasks.precision).toBeCloseTo(0.5);
    expect(report.failures.map(f => f.id)).toEqual(['b', 'e']);
    const text = markdown(report, { ...report, passRate: 0.4 });
    expect(text).toContain('Passed 3 of 5 (60%) (was 40%)');
    expect(text).toContain('- b: x');
  });
});
