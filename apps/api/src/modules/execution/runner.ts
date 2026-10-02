import { randomUUID } from 'node:crypto';
import type { Queryable,Task } from '@kian/db';
import type { ExecutionResult } from '@kian/contracts';
import { evaluateTrust } from '../trust/policy.js';
import type { StoredProposal } from '../tasks/approval.js';
import { transaction } from '../transaction.js';
import { learnTerms } from '../memory/store.js';

export type Executor=(owner:string,task:Task,key:string)=>Promise<ExecutionResult>;
/** `remember`: switched on in the app so that people an approved email went to are added to the user's memory; tests that do not have the memory table leave it off. */
export function createRunner(db:Queryable,execute:Executor,remember=false) {
  return {
    async run(owner:string,id:string):Promise<ExecutionResult|null> {
      const task=(await db.query("SELECT id,owner_id,action,state,parameters,version FROM tasks WHERE owner_id=$1 AND id=$2 AND state='queued'",[owner,id])).rows[0] as Task|undefined;
      if(!task) return null;
      const proposal=task.parameters as StoredProposal & {trustRuleId?:string};
      if(proposal.trustRuleId) {
        const rule=(await db.query('SELECT id,owner_id,connection_id,action,constraints,revoked_at FROM trust_rules WHERE owner_id=$1 AND id=$2',[owner,proposal.trustRuleId])).rows[0];
        const trust=evaluateTrust(owner,{action:task.action,connectionId:proposal.connectionId,destination:proposal.destination,parameters:proposal.fields,uncertainties:proposal.uncertainties},rule ? [{id:rule.id,ownerId:rule.owner_id,connectionId:rule.connection_id,action:rule.action,destinations:rule.constraints.destinations,revokedAt:rule.revoked_at}]:[]);
        if(!trust.allowed) {await db.query("UPDATE tasks SET state='proposed',version=version+1,parameters=parameters - 'trustRuleId' WHERE owner_id=$1 AND id=$2 AND state='queued' AND version=$3",[owner,id,task.version]);return null;}
      }
      const key=`${task.id}:${task.version}`;
      const claim=await db.query("INSERT INTO executions(id,owner_id,task_id,task_version,status) SELECT $1,owner_id,id,version,'running' FROM tasks WHERE owner_id=$2 AND id=$3 AND state='queued' AND version=$4 ON CONFLICT (task_id,task_version) DO NOTHING RETURNING id",[key,owner,id,task.version]);
      if(!claim.rows.length) return null;
      const started=await db.query("UPDATE tasks SET state='executing' WHERE owner_id=$1 AND id=$2 AND version=$3 AND state='queued' RETURNING id",[owner,id,task.version]);
      if(!started.rows.length) {
        await db.query("UPDATE executions SET status='failed',result=$2,completed_at=now() WHERE id=$1 AND status='running'",[key,JSON.stringify({status:'failed',error:'Task changed before execution; no provider write was attempted.'})]);
        return null;
      }
      let result:ExecutionResult;
      try {result=await execute(owner,task,key);} catch {result={status:'uncertain',error:'Execution was interrupted. Check the provider before trying again.'};}
      await transaction(db,async client=>{
        const saved=await client.query("UPDATE executions SET status=$2,result=$3,completed_at=now() WHERE id=$1 AND status='running' RETURNING id",[key,result.status,JSON.stringify(result)]);
        if(!saved.rows.length) {result={status:'uncertain',error:'Execution exceeded the recovery deadline. Check the provider.'};return;}
        await client.query('UPDATE tasks SET state=$4 WHERE owner_id=$1 AND id=$2 AND version=$3',[owner,id,task.version,result.status]);
        await client.query('INSERT INTO activity(id,owner_id,task_id,event,details) VALUES ($1,$2,$3,$4,$5)',[randomUUID(),owner,id,`task.${result.status}`,JSON.stringify(result)]);
        // An email the user approved and that was sent: its recipients (addresses the user wrote themselves) are remembered, never the message.
        if(remember && result.status==='succeeded' && task.action==='email.send') {
          const to=(proposal.fields as {to?:unknown}).to;
          const people=(Array.isArray(to) ? to:[]).filter((a):a is string=>typeof a==='string' && /^[^\s@]+@[^\s@]+$/.test(a)).slice(0,5).map(a=>({kind:'person' as const,value:a,detail:'Emailed'}));
          const added=await learnTerms(client,owner,people,'email');
          if(added>0) await client.query('INSERT INTO activity(id,owner_id,task_id,event,details) VALUES ($1,$2,NULL,$3,$4)',[randomUUID(),owner,'memory.learned',JSON.stringify({terms:added})]);
        }
      });
      return result;
    },
    async recoverInterrupted() {
      await transaction(db,async client=>{
        const result={status:'uncertain',error:'Execution interrupted. Check the provider before trying again.'};
        const rows=await client.query("UPDATE executions SET status='uncertain',result=$1,completed_at=now() WHERE status='running' AND created_at<now()-interval '5 minutes' RETURNING owner_id,task_id,task_version",[JSON.stringify(result)]);
        for(const row of rows.rows) {
          await client.query("UPDATE tasks SET state='uncertain' WHERE owner_id=$1 AND id=$2 AND version=$3 AND state IN ('queued','executing')",[row.owner_id,row.task_id,row.task_version]);
          await client.query('INSERT INTO activity(id,owner_id,task_id,event,details) VALUES ($1,$2,$3,$4,$5)',[randomUUID(),row.owner_id,row.task_id,'task.uncertain',JSON.stringify(result)]);
        }
        await client.query("UPDATE tasks t SET state=e.status FROM executions e WHERE t.id=e.task_id AND t.owner_id=e.owner_id AND t.version=e.task_version AND t.state IN ('queued','executing') AND e.status IN ('succeeded','failed','uncertain')");
      });
    },
  };
}
