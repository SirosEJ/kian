/** What the Home screen shows after Kian has answered a message: its reply, or a fallback note when there is neither a reply nor a task. */
export function describePlanResult(result: { reply?: unknown; tasks?: unknown }): { reply: string; notice: string } {
  const reply = typeof result.reply === 'string' ? result.reply.trim() : '';
  const hasTasks = Array.isArray(result.tasks) && result.tasks.length > 0;
  return { reply, notice: reply || hasTasks ? '' : 'Kian did not create any tasks from that instruction. Nothing will be sent or changed.' };
}
