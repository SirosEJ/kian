export type TaskId = string;
export type ConnectionId = string;
export type UserId = string;

export interface Queryable {
  query(sql: string, params?: unknown[]): Promise<{ rows: any[]; rowCount?: number | null }>;
}

export type Task = { id: TaskId; owner_id: UserId; action: string; state: string; parameters: unknown; version: number };
export type Connection = { id: ConnectionId; owner_id: UserId; provider: string; display_name: string; settings: unknown };

export class KianRepository {
  constructor(private readonly db: Queryable) {}

  async getTask(ownerId: UserId, taskId: TaskId): Promise<Task | null> {
    const result = await this.db.query('SELECT id, owner_id, action, state, parameters, version FROM tasks WHERE owner_id = $1 AND id = $2', [ownerId, taskId]);
    return (result.rows[0] as Task | undefined) ?? null;
  }

  async getConnection(ownerId: UserId, connectionId: ConnectionId): Promise<Connection | null> {
    const result = await this.db.query('SELECT id, owner_id, provider, display_name, settings FROM connections WHERE owner_id = $1 AND id = $2', [ownerId, connectionId]);
    return (result.rows[0] as Connection | undefined) ?? null;
  }

  async updateTaskState(ownerId: UserId, taskId: TaskId, state: string): Promise<boolean> {
    const result = await this.db.query('UPDATE tasks SET state = $3, version = version + 1 WHERE owner_id = $1 AND id = $2 RETURNING id', [ownerId, taskId, state]);
    return result.rows.length === 1;
  }
}
