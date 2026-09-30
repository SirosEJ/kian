import type { Queryable } from '@kian/db';
import { transaction } from '../transaction.js';
export function snapshotJiraFields(fields:Record<string,unknown>,settings:Record<string,unknown>) {
  return {...fields,issueTypeId:fields.issueTypeId || settings.issueTypeId || '',_jiraSiteId:settings.siteId || '',_jiraSiteUrl:settings.siteUrl || ''};
}
export async function saveJiraMapping(db:Queryable,owner:string,id:string,settings:Record<string,unknown>,replace=false) {
  await transaction(db,async client=>{
    await client.query(replace ? 'UPDATE connections SET settings=$3 WHERE owner_id=$1 AND id=$2': 'UPDATE connections SET settings=settings || $3::jsonb WHERE owner_id=$1 AND id=$2',[owner,id,JSON.stringify(settings)]);
    await client.query('UPDATE trust_rules SET revoked_at=now() WHERE owner_id=$1 AND connection_id=$2 AND revoked_at IS NULL',[owner,id]);
    await client.query("UPDATE tasks SET state='proposed',version=version+1,parameters=(parameters - 'trustRuleId') || jsonb_build_object('uncertainties',jsonb_build_array('Jira settings changed. Edit and review the selected site, project and issue type.')) WHERE owner_id=$1 AND parameters->>'connectionId'=$2 AND state IN ('proposed','queued')",[owner,id]);
  });
}
