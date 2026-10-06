/**
 * The connection provider names that can serve an action's provider. Email is sent from either an older IONOS mailbox
 * (`ionos`) or any mailbox connected with a preset (`mailbox`); the other providers have one name each.
 */
export const MAIL_PROVIDERS = ['ionos', 'mailbox'] as const;
export const isMailProvider = (provider: unknown): boolean => MAIL_PROVIDERS.includes(provider as never);
/** Whether a stored connection of `connectionProvider` can be used for an action that needs `wanted` (the planner calls email's provider `ionos`). */
export const serves = (connectionProvider: string, wanted: string): boolean => (wanted === 'ionos' ? isMailProvider(connectionProvider) : connectionProvider === wanted);
