import { describe, expect, it } from 'vitest';
import { evaluateTrust } from './policy.js';

const proposal = { action: 'email.send', connectionId: 'mail-1', destination: 'solmaz@example.com', parameters: { to: ['solmaz@example.com'], subject: 'Agenda', body: 'Hello' }, uncertainties: [] };
const rule = { id: 'r1', ownerId: 'alice', connectionId: 'mail-1', action: 'email.send', destinations: ['solmaz@example.com'], revokedAt: null };

describe('constrained trust', () => {
  it('matches only the owner, action, connection and destination', () => {
    expect(evaluateTrust('alice', proposal, [rule])).toEqual({ allowed: true, ruleId: 'r1' });
    expect(evaluateTrust('bob', proposal, [rule]).allowed).toBe(false);
    expect(evaluateTrust('alice', { ...proposal, destination: 'new@example.com', parameters: { ...proposal.parameters, to: ['new@example.com'] } }, [rule]).allowed).toBe(false);
    expect(evaluateTrust('alice', { ...proposal, parameters: { ...proposal.parameters, to: ['solmaz@example.com', 'new@example.com'] } }, [rule]).allowed).toBe(false);
    expect(evaluateTrust('alice', { ...proposal, connectionId: 'other' }, [rule]).allowed).toBe(false);
    expect(evaluateTrust('alice', { ...proposal, uncertainties: ['Which Solmaz?'] }, [rule]).allowed).toBe(false);
    expect(evaluateTrust('alice', proposal, [{ ...rule, revokedAt: new Date() }]).allowed).toBe(false);
  });
  it('rejects destructive actions and a new project or calendar', () => {
    expect(evaluateTrust('alice', { ...proposal, action: 'calendar.delete' }, [{ ...rule, action: 'calendar.delete' }]).allowed).toBe(false);
    expect(evaluateTrust('alice', { ...proposal, action: 'jira.create', destination: 'NEW' }, [{ ...rule, action: 'jira.create', destinations: ['SFT'] }]).allowed).toBe(false);
    expect(evaluateTrust('alice', { ...proposal, action: 'calendar.create', destination: 'other' }, [{ ...rule, action: 'calendar.create', destinations: ['primary'] }]).allowed).toBe(false);
  });
});
