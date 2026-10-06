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
    expect(new Set(CASES.map(c => c.area))).toEqual(new Set(['jira', 'calendar', 'actions', 'honesty', 'conversation']));
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

describe('running the evaluation reliably', () => {
  it('waits and retries a rate-limited call, gives up after four tries, and does not retry other failures', async () => {
    const { withRetry } = await import('./cli.js');
    const waits: number[] = [];
    let calls = 0;
    const flaky = async () => { calls++; if (calls < 3) throw Object.assign(new Error('429 Rate limit reached for gpt-4o'), { status: 429 }); return 'ok'; };
    expect(await withRetry(flaky, async ms => { waits.push(ms); })).toBe('ok');
    expect(waits).toEqual([15000, 30000]);
    let always = 0;
    await expect(withRetry(async () => { always++; throw new Error('Rate limit reached'); }, async () => {})).rejects.toThrow('Rate limit');
    expect(always).toBe(4);
    let other = 0;
    await expect(withRetry(async () => { other++; throw new Error('bad key'); }, async () => {})).rejects.toThrow('bad key');
    expect(other).toBe(1);
  });

  it('shows what Kian said next to each failure, so a failing case can be understood without re-running it', async () => {
    const c = CASES.find(x => x.id === 'cal-delete-find-first')!;
    const score = scoreCase(c, await run(c, { reply: 'Can you confirm the exact time of the event?', tasks: [] }), ctx);
    expect(score.saw).toContain('reply: Can you confirm the exact time');
    const text = markdown(buildReport([score]));
    expect(text).toContain('- cal-delete-find-first:');
    expect(text).toContain('reply: Can you confirm the exact time');
    const passing = CASES.find(x => x.id === 'honest-greeting')!;
    expect(scoreCase(passing, await run(passing, { reply: 'Hello!', tasks: [] }), ctx).saw).toBeUndefined();
  });
});

describe('timing in the report', () => {
  it('reports the median and the slowest tenth of the planner time when answers were timed, and nothing when they were not', () => {
    const base: CaseScore = { id: 'a', area: 'jira', expected: ['reply'], got: 'reply', pass: true, failures: [], clarified: false, unsafe: false };
    const timed = buildReport([1000, 2000, 3000, 4000, 10000].map((ms, i) => ({ ...base, id: `c${i}`, ms })));
    expect(timed.latency).toEqual({ medianMs: 3000, p90Ms: 10000 });
    expect(markdown(timed)).toMatch(/median 3\.0 s, slowest tenth 10\.0 s/);
    expect(buildReport([base]).latency).toBeUndefined();
    expect(markdown(buildReport([base]))).not.toMatch(/Planner time/);
  });
});
