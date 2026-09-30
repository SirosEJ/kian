import { z } from 'zod';
export type { Connector, Destination, ExecutionResult } from './connections.js';

export const ActionSchema = z.enum(['calendar.create','calendar.update','jira.create','jira.update','email.send']);
export const ModelProposalSchema = z.object({
  action: ActionSchema,
  connectionId: z.string().nullable(),
  destination: z.string().nullable(),
  parameters: z.record(z.string(), z.unknown()),
  uncertainties: z.array(z.string()),
});
export const TaskProposalSchema = ModelProposalSchema.extend({ id: z.string(), state: z.literal('proposed') });
export type TaskProposal = z.infer<typeof TaskProposalSchema>;
