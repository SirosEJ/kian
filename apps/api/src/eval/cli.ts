import { readFile, writeFile } from 'node:fs/promises';
import { planInstruction } from '../modules/tasks/plan.js';
import { buildReport, CASES, markdown, scoreCase, threadFor, type CaseScore, type Report } from './score.js';

/**
 * Runs every case against the real planning model and prints the metrics. Needs OPENAI_API_KEY; it costs a few cents per run.
 * Options: --min 0.85 (lowest acceptable pass rate), --runs 3 (ask each case several times: model answers vary),
 * --baseline path (compare with an earlier report), --out path (write the report as JSON).
 */
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
      try { scores.push(scoreCase(c, await planInstruction('eval', c.text, 'en-GB', 'Europe/London', threadFor(c)), ctx)); }
      catch (error) { scores.push({ id: c.id, area: c.area, expected: [], got: 'reply', pass: false, failures: [`the planner failed: ${(error as Error).message.slice(0, 120)}`], clarified: false, unsafe: false }); }
    }
  };
  await Promise.all(Array.from({ length: 4 }, worker));
  const report = buildReport(scores);
  let baseline: Report | null = null;
  try { baseline = JSON.parse(await readFile(arg('baseline', 'eval/baseline.json'), 'utf8')) as Report; } catch { /* no baseline yet */ }
  const text = markdown(report, baseline);
  console.log(text);
  if (process.env.GITHUB_STEP_SUMMARY) await writeFile(process.env.GITHUB_STEP_SUMMARY, `${text}\n`, { flag: 'a' });
  await writeFile(arg('out', 'eval-report.json'), JSON.stringify(report, null, 2));
  if (report.passRate < min || report.unsafe > 0) { console.error(`Below the bar: pass rate ${Math.round(report.passRate * 100)}% (minimum ${Math.round(min * 100)}%), unrequested actions ${report.unsafe}.`); process.exitCode = 1; }
}
void main();
