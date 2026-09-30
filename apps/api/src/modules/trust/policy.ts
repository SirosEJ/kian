export type TrustRule = { id: string; ownerId: string; connectionId: string; action: string; destinations: string[]; revokedAt: Date | string | null };
export type TrustProposal = { action: string; connectionId: string | null; destination: string | null; parameters: Record<string, unknown>; uncertainties: string[] };

export function evaluateTrust(ownerId: string, proposal: TrustProposal, activeRules: TrustRule[]): { allowed: boolean; ruleId?: string; reason?: string } {
  if (proposal.uncertainties.length) return { allowed: false, reason: 'Clarification required' };
  if (!['calendar.create','calendar.update','jira.create','jira.update','email.send'].includes(proposal.action)) return { allowed: false, reason: 'Action requires review' };
  if (!proposal.connectionId || !proposal.destination) return { allowed: false, reason: 'Destination required' };
  const recipients = proposal.action === 'email.send' ? proposal.parameters.to : undefined;
  if (proposal.action === 'email.send' && (!Array.isArray(recipients) || !recipients.length || recipients.some(r => typeof r !== 'string' || r.toLowerCase() !== proposal.destination?.toLowerCase()))) return { allowed: false, reason: 'Recipient requires review' };
  const match = activeRules.find(rule => rule.ownerId === ownerId && !rule.revokedAt && rule.connectionId === proposal.connectionId && rule.action === proposal.action && rule.destinations.includes(proposal.destination!));
  return match ? { allowed: true, ruleId: match.id } : { allowed: false, reason: 'No matching active rule' };
}
