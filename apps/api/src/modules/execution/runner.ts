import { randomUUID } from 'node:crypto';
import type { Queryable,Task } from '@kian/db';
import type { ExecutionResult } from '@kian/contracts';
import { evaluateTrust } from '../trust/policy.js';
import type { StoredProposal } from '../tasks/approval.js';

export type Executor=(owner:string,task:Task,key:string)=>Promise<ExecutionResult>;
export function createRunner(db:Queryable,execute:Executor) {
  return {
    async run(owner:string,id:string):Promise<ExecutionResult|null> {
      const task=(await db.query("SELECT id,owner_id,action,state,parameters,version FROM tasks WHERE owner_id=$1 AND id=$2 AND state='queued'",[owner,id])).rows[0] as Task|undefined;
      if(!task) return null;
      const proposal=task.parameters as StoredProposal & {trustRuleId?:string};
      if(proposal.trustRuleId) {
        const rule=(await db.query('SELECT id,owner_id,connection_id,action,constraints,revoked_at FROM trust_rules WHERE owner_id=$1 AND id=$2',[owner,proposal.trustRuleId])).rows[0];
        const trust=evaluateTrust(owner,{action:task.action,connectionId:proposal.connectionId,destination:proposal.destination,parameters:proposal.fields,uncertainties:proposal.uncertainties},rule ? [{id:rule.id,ownerId:rule.owner_id,connectionId:rule.connection_id,action:rule.action,destinations:rule.constraints.destinations,revokedAt:rule.revoked_at}]:[]);
        if(!trust.allowed) {await db.query("UPDATE tasks SET state='proposed',version=version+1 WHERE owner_id=$1 AND id=$2 AND state='queued' AND version=$3",[owner,id,task.version]);return null;}
      }
      const key=`${task.id}:${task.version}`;
      const claim=await db.query("INSERT INTO executions(id,owner_id,task_id,task_version,status) SELECT $1,owner_id,id,version,'running' FROM tasks WHERE owner_id=$2 AND id=$3 AND state='queued' AND version=$4 ON CONFLICT (task_id,task_version) DO NOTHING RETURNING id",[key,owner,id,task.version]);
      if(!claim.rows.length) return null;
      await db.query("UPDATE tasks SET state='executing' WHERE owner_id=$1 AND id=$2 AND version=$3 AND state='queued'",[owner,id,task.version]);
      let result:ExecutionResult;
      try {result=await execute(owner,task,key);} catch {result={status:'uncertain',error:'Execution was interrupted. Check the provider before trying again.'};}
      await db.query('UPDATE executions SET status=$2,result=$3,completed_at=now() WHERE id=$1',[key,result.status,JSON.stringify(result)]);
      await db.query('UPDATE tasks SET state=$4 WHERE owner_id=$1 AND id=$2 AND version=$3',[owner,id,task.version,result.status]);
      await db.query('INSERT INTO activity(id,owner_id,task_id,event,details) VALUES ($1,$2,$3,$4,$5)',[randomUUID(),owner,id,`task.${result.status}`,JSON.stringify(result)]);
      return result;
    },
    async recoverInterrupted() {
      const rows=await db.query("UPDATE executions SET status='uncertain',result=$1,completed_at=now() WHERE status='running' AND created_at<now()-interval '5 minutes' RETURNING owner_id,task_id,task_version",[JSON.stringify({status:'uncertain',error:'Execution interrupted. Check the provider before trying again.'})]);
      for(const row of rows.rows) await db.query("UPDATE tasks SET state='uncertain' WHERE owner_id=$1 AND id=$2 AND version=$3 AND state IN ('queued','executing')",[row.owner_id,row.task_id,row.task_version]);
    },
  };
}
