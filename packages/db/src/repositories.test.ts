import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { afterEach, describe, expect, it } from 'vitest';
import { KianRepository } from './repositories.js';

const databases: PGlite[] = [];
afterEach(async () => { await Promise.all(databases.splice(0).map(db => db.close())); });

describe('owner-scoped repository', () => {
  it('returns only the owner task and connection even when another ID is known', async () => {
    const db = new PGlite(); databases.push(db);
    await db.exec(readFileSync(new URL('../migrations/001_core.sql', import.meta.url), 'utf8'));
    await db.query("INSERT INTO users (id) VALUES ('alice'), ('bob')");
    await db.query("INSERT INTO connections (id, owner_id, provider, display_name) VALUES ('ca','alice','jira','A'),('cb','bob','jira','B')");
    await db.query("INSERT INTO tasks (id, owner_id, action, state, parameters) VALUES ('ta','alice','jira.create','proposed','{}'),('tb','bob','jira.create','proposed','{}')");
    const repo = new KianRepository(db);
    expect((await repo.getTask('alice','ta'))?.id).toBe('ta');
    expect(await repo.getTask('alice','tb')).toBeNull();
    expect((await repo.getConnection('alice','ca'))?.id).toBe('ca');
    expect(await repo.getConnection('alice','cb')).toBeNull();
    expect(await repo.updateTaskState('alice','tb','approved')).toBe(false);
    expect((await repo.getTask('bob','tb'))?.state).toBe('proposed');
  });
});
