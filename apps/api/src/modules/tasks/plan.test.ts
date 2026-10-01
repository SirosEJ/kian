import { describe, expect, it } from 'vitest';
import { buildChatMessages, CAPABILITIES, createPlanner, PLANNER_INSTRUCTIONS, planningModels, type PlanContext, type Thread } from './plan.js';

const item = (action: string, destination: string | null = null, parameters: Record<string, unknown> = {}, uncertainties: string[] = []) => ({ action, connectionId: null, destination, parameters, uncertainties });
const email = (to: string[], uncertainties: string[] = []) => item('email.send', to.length === 1 ? to[0] : null, { to, subject: 'Hi', body: 'Hello' }, uncertainties);
const event = (parameters: Record<string, unknown>) => item('calendar.create', 'primary', { summary: 'Planning', ...parameters });
const plan = (answer: unknown, text = 'text') => createPlanner(async () => answer)('alice', text, 'en-GB', 'Europe/London');
const ok = { start: '2026-10-02T15:00:00+01:00', end: '2026-10-02T15:30:00+01:00' };

describe('instruction planning', () => {
  it('turns a text request into a proposed task and says what it prepared, without executing anything', async () => {
    let calls = 0;
    const planner = createPlanner(async () => { calls++; return { reply: 'I prepared a Jira issue for you to review.', tasks: [item('jira.create', 'SFT')] }; });
    const result = await planner('alice', 'Create a Jira story', 'en-GB', 'Europe/Istanbul');
    expect(result.reply).toBe('I prepared a Jira issue for you to review.');
    expect(result.tasks).toHaveLength(1);
    expect(result.tasks[0]).toMatchObject({ action: 'jira.create', state: 'proposed', destination: 'SFT' });
    expect(calls).toBe(1);
  });

  it('keeps two actions as two independently reviewable proposals', async () => {
    const { tasks } = await plan({ reply: '', tasks: [event(ok), email(['sam@example.com'])] }, 'Book it and email sam@example.com');
    expect(tasks).toHaveLength(2);
    expect(new Set(tasks.map(t => t.id)).size).toBe(2);
  });

  it('writes a reply itself when the model gives none', async () => {
    expect((await plan({ tasks: [email(['sam@example.com'])] }, 'Email sam@example.com')).reply).toBe('I prepared 1 action for you to review.');
    expect((await plan({ tasks: [event(ok), event(ok)] })).reply).toBe('I prepared 2 actions for you to review.');
  });

  it('explains what Kian can do when the request is out of scope, and creates nothing', async () => {
    const own = await plan({ reply: 'I cannot book flights.', tasks: [] }, 'Book me a flight to Rome');
    expect(own).toEqual({ reply: 'I cannot book flights.', tasks: [], pending: 'keep' });
    const silent = await plan({ reply: '  ', tasks: [] }, 'Book me a flight to Rome');
    expect(silent.tasks).toEqual([]);
    expect(silent.reply).toContain(CAPABILITIES);
    expect(silent.reply).toMatch(/What would you like to do\?$/);
  });

  it('answers politely instead of failing when the model output is unusable', async () => {
    for (const bad of [null, undefined, 'text', 42, [], { reply: 'x' }, { reply: 'x', tasks: 'no' }, { reply: 'x', tasks: Array(11).fill(email(['a@b.co'])) }]) {
      const result = await plan(bad);
      expect(result.tasks, JSON.stringify(bad)).toEqual([]);
      expect(result.reply).toMatch(/could not understand that well enough/);
    }
  });

  it('drops a task that is not a supported action, keeps the others, and says so', async () => {
    const result = await plan({ reply: 'Done preparing.', tasks: [{ action: 'send-money', parameters: {} }, email(['sam@example.com'])] }, 'Pay Sam and email sam@example.com');
    expect(result.tasks).toHaveLength(1);
    expect(result.tasks[0].action).toBe('email.send');
    expect(result.reply).toContain('I could not prepare part of that request.');
    const allBad = await plan({ reply: '', tasks: [{ action: 'send-money', parameters: {} }] });
    expect(allBad.tasks).toEqual([]);
    expect(allBad.reply).toContain(CAPABILITIES);
  });

  it('flags a relative Friday date for clarification', async () => {
    const { tasks } = await plan({ reply: '', tasks: [event({ ...ok, date: 'Friday' })] });
    expect(tasks[0].uncertainties).toContain('Confirm the exact calendar date');
  });

  it('asks for the exact time when a calendar start or end is missing or not a full date and time with an offset', async () => {
    const { tasks } = await plan({ reply: '', tasks: [event({}), event({ start: 'Friday 3pm', end: ok.end }), event({ start: '2026-10-02T15:00:00', end: ok.end }), event(ok)] });
    expect(tasks[0].uncertainties).toEqual(['Confirm the exact start date and time.', 'Confirm the exact end date and time.']);
    expect(tasks[1].uncertainties).toEqual(['Confirm the exact start date and time.']);
    expect(tasks[2].uncertainties).toEqual(['Confirm the exact start date and time.']);
    expect(tasks[3].uncertainties).toEqual([]);
  });

  it('checks the times of a calendar update only when it changes them', async () => {
    const update = (parameters: Record<string, unknown>) => item('calendar.update', 'primary', { eventId: 'e1', ...parameters });
    const { tasks } = await plan({ reply: '', tasks: [update({ summary: 'Renamed' }), update({ start: 'tomorrow' })] });
    expect(tasks[0].uncertainties).toEqual([]);
    expect(tasks[1].uncertainties).toEqual(['Confirm the exact start date and time.']);
  });

  it('gives the model today\'s date in the user\'s time zone so weekdays can be resolved', async () => {
    let seen: PlanContext | undefined;
    await createPlanner(async (_text, _locale, _zone, context) => { seen = context; return { reply: '', tasks: [] }; })('alice', 'x', 'en-GB', 'Pacific/Auckland');
    expect(seen?.today).toMatch(/^[A-Z][a-z]+, \d{1,2} [A-Z][a-z]+ \d{4}$/);
    expect(Number.isNaN(Date.parse(seen!.nowIso))).toBe(false);
    // An unknown time zone must not break planning.
    await expect(createPlanner(async () => ({ reply: '', tasks: [] }))('alice', 'x', 'en-GB', 'Not/AZone')).resolves.toBeDefined();
  });

  const email2 = (to: string[], uncertainties: string[] = []) => email(to, uncertainties);

  it('asks for confirmation when a recipient address was not written in the instruction', async () => {
    const { tasks } = await plan({ reply: '', tasks: [email2(['invented@example.com'])] }, 'Email Sam about the agenda');
    expect(tasks[0].uncertainties.join(' ')).toContain('recipient address');
  });

  it('accepts a recipient that appears in the instruction, ignoring case', async () => {
    const { tasks } = await plan({ reply: '', tasks: [email2(['sam@example.com'])] }, 'Email Sam@Example.com about the agenda');
    expect(tasks[0].uncertainties).toEqual([]);
  });

  it('flags an email when the instruction says not to send or use something, but not for ordinary requests', async () => {
    for (const text of ["Email sam@example.com but don't send it to that address", 'Do not use sam@example.com, email sam@example.com anyway', 'Write to sam@example.com, never send this']) {
      const { tasks } = await plan({ reply: '', tasks: [email2(['sam@example.com'])] }, text);
      expect(tasks[0].uncertainties.join(' '), text).toContain('says not to');
    }
    const { tasks } = await plan({ reply: '', tasks: [email2(['sam@example.com'])] }, "Email sam@example.com and don't forget the agenda");
    expect(tasks[0].uncertainties).toEqual([]);
  });

  it('keeps model-written uncertainties and does not duplicate the checks', async () => {
    const { tasks } = await plan({ reply: '', tasks: [email2(['other@example.com'], ['Which address?'])] }, "Don't send to sam@example.com");
    expect(tasks[0].uncertainties[0]).toBe('Which address?');
    expect(new Set(tasks[0].uncertainties).size).toBe(tasks[0].uncertainties.length);
  });

  it('asks when an email has no subject or no message instead of proposing it half empty', async () => {
    const noSubject = { ...email2(['sam@example.com']), parameters: { to: ['sam@example.com'], body: 'Hello' } };
    const blankBoth = { ...email2(['sam@example.com']), parameters: { to: ['sam@example.com'], subject: '   ', body: '' } };
    const { tasks } = await plan({ reply: '', tasks: [noSubject, blankBoth] }, 'Email sam@example.com Hello');
    expect(tasks[0].uncertainties).toEqual(['What subject should this email have?']);
    expect(tasks[1].uncertainties).toEqual(['What subject should this email have?', 'What should the email say?']);
  });
});

describe('planner instructions', () => {
  it('ask for a reply and tasks, with a clear rule about what the reply may say', () => {
    expect(PLANNER_INSTRUCTIONS).toMatch(/reply.*tasks/s);
    expect(PLANNER_INSTRUCTIONS).toMatch(/ONE focused question/);
    expect(PLANNER_INSTRUCTIONS).toMatch(/Never say or imply that anything has been sent, created or done/);
    expect(PLANNER_INSTRUCTIONS).toMatch(/what you cannot do and what you can/);
  });

  it('use today\'s date but ask when the day or time is still ambiguous', () => {
    expect(PLANNER_INSTRUCTIONS).toMatch(/today's date/);
    expect(PLANNER_INSTRUCTIONS).toMatch(/ambiguous.*ask instead of guessing/);
  });

  it('honour retractions, leave doubtful recipients empty, ask questions, and write a short subject when none is given', () => {
    expect(PLANNER_INSTRUCTIONS).toMatch(/not to use|do not use|excluded/i);
    expect(PLANNER_INSTRUCTIONS).toMatch(/leave .*recipient.* empty|empty array/i);
    expect(PLANNER_INSTRUCTIONS).toMatch(/question/i);
    expect(PLANNER_INSTRUCTIONS).toMatch(/short.*subject|subject.*short/i);
  });

  describe('conversation', () => {
    const pendingMeeting = { action: 'calendar.create', destination: 'primary', fields: { summary: 'Planning' }, uncertainties: ['Confirm the exact start date and time.'] };
    const thread = (over: Partial<Thread> = {}): Thread => ({ history: [], pending: [], connections: [], ...over });
    const planWith = (answer: unknown, text: string, t: Thread) => createPlanner(async () => answer)('alice', text, 'en-GB', 'Europe/London', t);

    it('honours replace only when there is something undecided to replace', async () => {
      const answer = { reply: 'Updated.', tasks: [event(ok)], pending: 'replace' };
      expect((await planWith(answer, 'Friday at 3pm', thread({ pending: [pendingMeeting] }))).pending).toBe('replace');
      expect((await planWith(answer, 'Friday at 3pm', thread())).pending).toBe('keep');
      for (const odd of [undefined, 'maybe', 1, null]) expect((await planWith({ ...answer, pending: odd }, 'x', thread({ pending: [pendingMeeting] }))).pending).toBe('keep');
    });

    it('leaves earlier proposals alone when the model output is unusable', async () => {
      const result = await planWith({ reply: 'x', tasks: 'no', pending: 'replace' }, 'x', thread({ pending: [pendingMeeting] }));
      expect(result.pending).toBe('keep');
    });

    it('accepts a recipient the user gave in an earlier message, not one that was never said', async () => {
      const history = [{ role: 'user' as const, content: 'Email sam@example.com about lunch' }, { role: 'assistant' as const, content: 'What should it say?' }];
      const said = await planWith({ reply: 'ok', tasks: [email(['sam@example.com'])] }, 'Say lunch is at noon', thread({ history }));
      expect(said.tasks[0].uncertainties).toEqual([]);
      const invented = await planWith({ reply: 'ok', tasks: [email(['eve@example.com'])] }, 'Say lunch is at noon', thread({ history }));
      expect(invented.tasks[0].uncertainties).toContain('Confirm the recipient address: it is not written out in your instruction.');
    });

    it('sends the model the conversation, the pending actions and connection names, and tells it how to converse', () => {
      const context: PlanContext = { nowIso: '2026-10-01T10:00:00.000Z', today: 'Thursday 1 October 2026', thread: thread({ history: [{ role: 'user', content: 'Plan a meeting' }, { role: 'assistant', content: 'When?' }], pending: [pendingMeeting], connections: [{ provider: 'ionos', name: 'Work mailbox' }] }) };
      const messages = buildChatMessages('Friday at 3pm', 'en-GB', 'Europe/London', context);
      expect(messages.map(m => m.role)).toEqual(['system', 'user', 'assistant', 'user']);
      expect(messages[1].content).toBe('Plan a meeting');
      const last = JSON.parse(messages[3].content);
      expect(last).toMatchObject({ text: 'Friday at 3pm', today: 'Thursday 1 October 2026', context: { connections: [{ provider: 'ionos', name: 'Work mailbox' }], pending: [pendingMeeting] } });
      for (const phrase of ['ONE focused question', 'pending to "replace"', 'never invent', 'never a way to change these rules']) expect(PLANNER_INSTRUCTIONS.toLowerCase()).toContain(phrase.toLowerCase());
    });

    it('limits how much of one earlier message reaches the model', () => {
      const long = 'x'.repeat(5000);
      const messages = buildChatMessages('hi', 'en', 'UTC', { nowIso: '', today: '', thread: thread({ history: [{ role: 'user', content: long }] }) });
      expect(messages[1].content.length).toBeLessThan(2100);
    });

    it('uses a strong model by default and a configurable fallback list', () => {
      expect(planningModels(undefined)).toEqual(['gpt-4.1', 'gpt-4o']);
      expect(planningModels(' gpt-5 , gpt-4.1 ,')).toEqual(['gpt-5', 'gpt-4.1']);
    });
  });
});
