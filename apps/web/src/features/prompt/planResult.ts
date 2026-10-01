/** What the Home screen shows after Kian has answered a message: its reply, or a fallback note when there is neither a reply nor a task. */
export function describePlanResult(result: { reply?: unknown; tasks?: unknown }): { reply: string; notice: string } {
  const reply = typeof result.reply === 'string' ? result.reply.trim() : '';
  const hasTasks = Array.isArray(result.tasks) && result.tasks.length > 0;
  return { reply, notice: reply || hasTasks ? '' : 'Kian did not create any tasks from that instruction. Nothing will be sent or changed.' };
}

const GENERIC_FAILURE = 'Could not reach Kian. Your message is still here; check it and try again.';
/** Why a message could not be sent. A refusal with its own explanation (too long, too fast, conversation full) is shown as it is; anything else stays generic. */
export function sendFailure(error: unknown): string {
  const { status, message } = (error ?? {}) as { status?: number; message?: string };
  return typeof status === 'number' && [400, 409, 429].includes(status) && message ? message : GENERIC_FAILURE;
}
