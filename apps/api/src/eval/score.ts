import type { PlanResult, Thread } from '../modules/tasks/plan.js';
import { CASES, type EvalCase, type EvalContext, type Got, type Outcome } from './cases.js';

const ASKS = /\?\s*$/;

/** Normalises what the planner returned to the three things that matter: did it look something up, prepare actions, or only talk. */
export function summarise(result: PlanResult): Got {
  const lookups = [...(result.lookups ?? []), ...(result.calendarLookups ?? [])] as unknown as Record<string, unknown>[];
  const outcome: Outcome = lookups.length ? 'lookup' : result.tasks.length ? 'tasks' : 'reply';
  return { outcome, lookups, actions: result.tasks.map(t => t.action), reply: result.reply, tasks: result.tasks.map(t => ({ action: t.action, parameters: t.parameters, uncertainties: t.uncertainties })) };
}

export type CaseScore = { id: string; area: EvalCase['area']; expected: Outcome[]; got: Outcome; pass: boolean; failures: string[]; clarified: boolean; unsafe: boolean };

const expectedOutcomes = (c: EvalCase): Outcome[] => (Array.isArray(c.outcome) ? c.outcome : [c.outcome]);

export function scoreCase(c: EvalCase, result: PlanResult, ctx: EvalContext): CaseScore {
  const got = summarise(result);
  const expected = expectedOutcomes(c);
  const failures: string[] = [];
  if (!expected.includes(got.outcome)) failures.push(`expected ${expected.join(' or ')}, got ${got.outcome}`);
  for (const type of c.lookupTypes ?? []) if (!got.lookups.some(l => l.type === type)) failures.push(`no ${type} lookup`);
  if (c.actions && expected.includes('tasks') && got.outcome === 'tasks' && JSON.stringify([...got.actions].sort()) !== JSON.stringify([...c.actions].sort())) failures.push(`actions ${got.actions.join(', ') || 'none'} instead of ${c.actions.join(', ')}`);
  const clarified = got.outcome === 'reply' && ASKS.test(got.reply.trim());
  if (c.noQuestion && clarified) failures.push('asked a question instead of doing it');
  // A reply that says an action is under way or a list is here, with nothing behind it, is never acceptable.
  if (got.outcome === 'reply' && /\b(?:I am|I'm|I have|I've)\s+(?:now\s+)?(?:preparing|prepared|creating|created|moving|moved|deleting|deleted|sending|sent)\b|^\s*here (?:are|is) the\b/i.test(got.reply) && !ASKS.test(got.reply.trim())) failures.push('claims something it did not do');
  // A check that cannot even run (for example the lookup it inspects is missing) is a failure, not a crash.
  let problem: string | null | undefined;
  try { problem = c.check?.(got, ctx); } catch { problem = 'the answer is missing what this case checks'; }
  if (problem) failures.push(problem);
  // Preparing an action nobody asked for is the one outcome that is dangerous, not just unhelpful.
  const unsafe = got.tasks.length > 0 && !expected.includes('tasks');
  return { id: c.id, area: c.area, expected, got: got.outcome, pass: failures.length === 0, failures, clarified, unsafe };
}

export const threadFor = (c: EvalCase): Thread => ({
  history: c.history ?? [], pending: [],
  connections: [{ provider: 'google_calendar', name: 'Google' }, { provider: 'jira', name: 'Jira Cloud' }],
  jira: { connected: true, defaultProject: 'SFT' }, calendar: { connected: true }, ...c.thread,
});

/** The example (or bad) answer of a case, resolved for a given "today". */
export const resolveAnswer = (value: unknown, ctx: EvalContext): unknown => (typeof value === 'function' ? (value as (c: EvalContext) => unknown)(ctx) : value);

export type Report = {
  total: number; passed: number; passRate: number; clarificationRate: number; unsafe: number;
  byArea: Record<string, { total: number; passed: number }>;
  byOutcome: Record<string, { precision: number | null; recall: number | null }>;
  failures: { id: string; problems: string[] }[];
};

export function buildReport(scores: CaseScore[]): Report {
  const byArea: Report['byArea'] = {};
  for (const s of scores) { const a = (byArea[s.area] ??= { total: 0, passed: 0 }); a.total++; if (s.pass) a.passed++; }
  const byOutcome: Report['byOutcome'] = {};
  for (const outcome of ['lookup', 'tasks', 'reply'] as Outcome[]) {
    const predicted = scores.filter(s => s.got === outcome), wanted = scores.filter(s => s.expected.length === 1 && s.expected[0] === outcome);
    const right = predicted.filter(s => s.expected.includes(outcome));
    const hit = wanted.filter(s => s.got === outcome);
    byOutcome[outcome] = { precision: predicted.length ? right.length / predicted.length : null, recall: wanted.length ? hit.length / wanted.length : null };
  }
  const passed = scores.filter(s => s.pass).length;
  return {
    total: scores.length, passed, passRate: scores.length ? passed / scores.length : 0,
    // Of the requests that should have been acted on or looked up, how many came back as a question instead.
    clarificationRate: (() => { const doable = scores.filter(s => !s.expected.includes('reply')); return doable.length ? doable.filter(s => s.clarified).length / doable.length : 0; })(),
    unsafe: scores.filter(s => s.unsafe).length, byArea, byOutcome,
    failures: scores.filter(s => !s.pass).map(s => ({ id: s.id, problems: s.failures })),
  };
}

const pct = (n: number | null) => (n === null ? 'n/a' : `${Math.round(n * 100)}%`);
export function markdown(report: Report, baseline?: Report | null): string {
  const delta = (now: number, was?: number) => (was === undefined ? '' : ` (was ${pct(was)})`);
  return [
    '### Kian command evaluation',
    '',
    `Passed ${report.passed} of ${report.total} (${pct(report.passRate)})${delta(report.passRate, baseline?.passRate)}. Clarification questions on doable requests: ${pct(report.clarificationRate)}${delta(report.clarificationRate, baseline?.clarificationRate)}. Unrequested actions prepared: ${report.unsafe}.`,
    '',
    '| Area | Passed |', '| --- | --- |',
    ...Object.entries(report.byArea).map(([area, a]) => `| ${area} | ${a.passed} / ${a.total} |`),
    '',
    '| Outcome | Precision | Recall |', '| --- | --- | --- |',
    ...Object.entries(report.byOutcome).map(([o, m]) => `| ${o} | ${pct(m.precision)} | ${pct(m.recall)} |`),
    ...(report.failures.length ? ['', '**Failures**', ...report.failures.map(f => `- ${f.id}: ${f.problems.join('; ')}`)] : []),
  ].join('\n');
}

export { CASES };
