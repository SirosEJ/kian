import { readFile, writeFile } from 'node:fs/promises';
import { planInstruction } from '../modules/tasks/plan.js';
import { buildReport, CASES, markdown, scoreCase, threadFor, type CaseScore, type Report } from './score.js';

/**
 * Runs every case against the real planning model and prints the metrics. Needs OPENAI_API_KEY; it costs a few cents per run.
 * Options: --min 0.85 (lowest acceptable pass rate), --runs 3 (ask each case several times: model answers vary),
 * --baseline path (compare with an earlier report), --out path (write the report as JSON).
 */
/** A rate-limited call is waited for and tried again (up to four times); any other failure is reported as it is. */
export async function withRetry<T>(call: () => Promise<T>, wait: (ms: number) => Promise<void> = ms => new Promise(r => setTimeout(r, ms))): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try { return await call(); }
    catch (error) {
      const limited = (error as { status?: number }).status === 429 || /\b429\b|rate limit/i.test(String((error as Error).message));
      if (!limited || attempt >= 3) throw error;
      await wait(15000 * (attempt + 1));
    }
  }
}

async function main() {
  const args = process.argv.slice(2);
  const arg = (name: string, fallback: string) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : fallback; };
  const min = Number(arg('min', '0.85')), runs = Math.max(1, Number(arg('runs', '1')));
  if (!process.env.OPENAI_API_KEY) { console.log('OPENAI_API_KEY is not set, so the live evaluation was skipped.'); return; }
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London' }).format(new Date());
  const ctx = { today };
  const scores: CaseScore[] = [];
  const queue = CASES.flatMap(c => Array.from({ length: runs }, () => c));
  const worker = async () => {
    for (let c = queue.shift(); c; c = queue.shift()) {
      const started = Date.now();
      try { const result = await withRetry(() => planInstruction('eval', c.text, 'en-GB', 'Europe/London', threadFor(c))); scores.push({ ...scoreCase(c, result, ctx), ms: Date.now() - started }); }
      catch (error) { scores.push({ id: c.id, area: c.area, expected: [], got: 'reply', pass: false, failures: [`the planner failed: ${(error as Error).message.slice(0, 120)}`], clarified: false, unsafe: false }); }
    }
  };
  // Two calls at a time: more than that runs into the provider's tokens-per-minute limit.
  await Promise.all(Array.from({ length: 2 }, worker));
  const report = buildReport(scores);
  let baseline: Report | null = null;
  try { baseline = JSON.parse(await readFile(arg('baseline', 'eval/baseline.json'), 'utf8')) as Report; } catch { /* no baseline yet */ }
  const text = markdown(report, baseline);
  console.log(text);
  if (process.env.GITHUB_STEP_SUMMARY) await writeFile(process.env.GITHUB_STEP_SUMMARY, `${text}\n`, { flag: 'a' });
  await writeFile(arg('out', 'eval-report.json'), JSON.stringify(report, null, 2));
  if (report.passRate < min || report.unsafe > 0) { console.error(`Below the bar: pass rate ${Math.round(report.passRate * 100)}% (minimum ${Math.round(min * 100)}%), unrequested actions ${report.unsafe}.`); process.exitCode = 1; }
}
if (process.argv[1]?.endsWith('/eval/cli.js')) void main();
