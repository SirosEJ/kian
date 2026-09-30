import type { Queryable } from '@kian/db';
export async function transaction<T>(db:Queryable,operation:(client:Queryable)=>Promise<T>):Promise<T> {
  const client='connect' in db && typeof db.connect==='function' ? await (db as Queryable & {connect:()=>Promise<Queryable & {release:()=>void}>}).connect():db;
  try {await client.query('BEGIN');const result=await operation(client);await client.query('COMMIT');return result;}
  catch(error) {await client.query('ROLLBACK');throw error;}
  finally {if('release' in client && typeof client.release==='function') client.release();}
}
