import type { Queryable } from '@kian/db';
type Pooled=Queryable & {connect:()=>Promise<Queryable & {release:()=>void}>};
/** A pg Pool has connect() but no release(); a checked-out PoolClient has both, and connecting it again throws. */
export const isPool=(db:Queryable):db is Pooled=>'connect' in db && typeof db.connect==='function' && !('release' in db);
export async function transaction<T>(db:Queryable,operation:(client:Queryable)=>Promise<T>):Promise<T> {
  const client=isPool(db) ? await db.connect():db;
  try {await client.query('BEGIN');const result=await operation(client);await client.query('COMMIT');return result;}
  catch(error) {await client.query('ROLLBACK');throw error;}
  finally {if('release' in client && typeof client.release==='function') client.release();}
}
